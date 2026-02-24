from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryInstructionTemplate
from app.schemas import (
    MessageResponse,
    StoryInstructionTemplateCreateRequest,
    StoryInstructionTemplateOut,
    StoryInstructionTemplateUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_cards import (
    normalize_story_instruction_content,
    normalize_story_instruction_title,
)
from app.services.story_queries import (
    get_story_instruction_template_for_user_or_404,
    list_story_instruction_templates,
)

router = APIRouter()


@router.get("/api/story/instruction-templates", response_model=list[StoryInstructionTemplateOut])
def list_story_instruction_templates_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryInstructionTemplateOut]:
    user = get_current_user(db, authorization)
    templates = list_story_instruction_templates(db, user.id)
    return [StoryInstructionTemplateOut.model_validate(template) for template in templates]


@router.post("/api/story/instruction-templates", response_model=StoryInstructionTemplateOut)
def create_story_instruction_template(
    payload: StoryInstructionTemplateCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionTemplateOut:
    user = get_current_user(db, authorization)
    template = StoryInstructionTemplate(
        user_id=user.id,
        title=normalize_story_instruction_title(payload.title),
        content=normalize_story_instruction_content(payload.content),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return StoryInstructionTemplateOut.model_validate(template)


@router.patch("/api/story/instruction-templates/{template_id}", response_model=StoryInstructionTemplateOut)
def update_story_instruction_template(
    template_id: int,
    payload: StoryInstructionTemplateUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionTemplateOut:
    user = get_current_user(db, authorization)
    template = get_story_instruction_template_for_user_or_404(db, user.id, template_id)
    template.title = normalize_story_instruction_title(payload.title)
    template.content = normalize_story_instruction_content(payload.content)
    db.commit()
    db.refresh(template)
    return StoryInstructionTemplateOut.model_validate(template)


@router.delete("/api/story/instruction-templates/{template_id}", response_model=MessageResponse)
def delete_story_instruction_template(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    template = get_story_instruction_template_for_user_or_404(db, user.id, template_id)
    db.delete(template)
    db.commit()
    return MessageResponse(message="Instruction template deleted")
