from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ReferralApplyRequest, ReferralApplyResponse, ReferralSummaryOut
from app.services.auth_identity import get_current_user
from app.services.referrals import apply_referral_code, build_referral_summary

router = APIRouter()


@router.get("/api/referrals/me", response_model=ReferralSummaryOut)
def get_my_referral_summary(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ReferralSummaryOut:
    user = get_current_user(db, authorization)
    summary = build_referral_summary(db, user)
    db.commit()
    db.refresh(user)
    return ReferralSummaryOut(
        referral_code=summary.referral_code,
        paid_referrals_count=summary.paid_referrals_count,
        referral_pending_purchase=summary.referral_pending_purchase,
        pending_bonus_amount=summary.pending_bonus_amount,
    )


@router.post("/api/referrals/apply", response_model=ReferralApplyResponse)
def apply_my_referral_code(
    payload: ReferralApplyRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ReferralApplyResponse:
    user = get_current_user(db, authorization)
    result = apply_referral_code(db, user=user, raw_code=payload.code)
    db.commit()
    db.refresh(user)
    return ReferralApplyResponse(
        ok=result.ok,
        reason=result.reason,
        message=result.message,
        referral_pending_purchase=result.referral_pending_purchase,
        pending_bonus_amount=result.pending_bonus_amount,
        referrer_user_id=result.referrer_user_id,
    )
