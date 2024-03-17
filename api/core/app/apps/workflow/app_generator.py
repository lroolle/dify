import logging
import threading
import uuid
from collections.abc import Generator
from typing import Union

from flask import Flask, current_app
from pydantic import ValidationError

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, GenerateTaskStoppedException, PublishFrom
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.task_entities import WorkflowAppBlockingResponse, WorkflowAppStreamResponse
from core.file.message_file_parser import MessageFileParser
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowAppGenerator(BaseAppGenerator):
    def generate(self, app_model: App,
                 workflow: Workflow,
                 user: Union[Account, EndUser],
                 args: dict,
                 invoke_from: InvokeFrom,
                 stream: bool = True) \
            -> Union[dict, Generator[dict, None, None]]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param stream: is stream
        """
        inputs = args['inputs']

        # parse files
        files = args['files'] if 'files' in args and args['files'] else []
        message_file_parser = MessageFileParser(tenant_id=app_model.tenant_id, app_id=app_model.id)
        file_extra_config = FileUploadConfigManager.convert(workflow.features_dict)
        if file_extra_config:
            file_objs = message_file_parser.validate_and_transform_files_arg(
                files,
                file_extra_config,
                user
            )
        else:
            file_objs = []

        # convert to app config
        app_config = WorkflowAppConfigManager.get_app_config(
            app_model=app_model,
            workflow=workflow
        )

        # init application generate entity
        application_generate_entity = WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            inputs=self._get_cleaned_inputs(inputs, app_config),
            files=file_objs,
            user_id=user.id,
            stream=stream,
            invoke_from=invoke_from
        )

        # init queue manager
        queue_manager = WorkflowAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            app_mode=app_model.mode
        )

        # new thread
        worker_thread = threading.Thread(target=self._generate_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'application_generate_entity': application_generate_entity,
            'queue_manager': queue_manager
        })

        worker_thread.start()

        # return response or stream generator
        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            stream=stream
        )

        return WorkflowAppGenerateResponseConverter.convert(
            response=response,
            invoke_from=invoke_from
        )

    def _generate_worker(self, flask_app: Flask,
                         application_generate_entity: WorkflowAppGenerateEntity,
                         queue_manager: AppQueueManager) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :return:
        """
        with flask_app.app_context():
            try:
                # workflow app
                runner = WorkflowAppRunner()
                runner.run(
                    application_generate_entity=application_generate_entity,
                    queue_manager=queue_manager
                )
            except GenerateTaskStoppedException:
                pass
            except InvokeAuthorizationError:
                queue_manager.publish_error(
                    InvokeAuthorizationError('Incorrect API key provided'),
                    PublishFrom.APPLICATION_MANAGER
                )
            except ValidationError as e:
                logger.exception("Validation Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except (ValueError, InvokeError) as e:
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.remove()

    def _handle_response(self, application_generate_entity: WorkflowAppGenerateEntity,
                         workflow: Workflow,
                         queue_manager: AppQueueManager,
                         user: Union[Account, EndUser],
                         stream: bool = False) -> Union[
        WorkflowAppBlockingResponse,
        Generator[WorkflowAppStreamResponse, None, None]
    ]:
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param user: account or end user
        :param stream: is stream
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            stream=stream
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedException()
            else:
                logger.exception(e)
                raise e
