"""
Backend JWT authentication dependency.

Verifies Supabase JWTs (HS256, signed with SUPABASE_JWT_SECRET).
Routes that require auth should use: Depends(get_current_user_id)
"""
import logging
from typing import Optional
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from backend.config import get_settings

logger = logging.getLogger("trace.auth")
settings = get_settings()

_bearer_scheme = HTTPBearer(auto_error=False)


def _decode_token(token: str) -> dict:
    """Decode and verify a Supabase JWT. Raises HTTPException on failure."""
    secret = settings.supabase_jwt_secret
    if not secret:
        # JWT secret not configured → skip verification (dev/local mode)
        logger.warning(
            "SUPABASE_JWT_SECRET not set — JWT verification is DISABLED. "
            "Set it in .env before deploying to production."
        )
        # Decode without signature verification to extract sub claim
        try:
            return jwt.decode(
                token,
                "dev-placeholder-key",  # jose requires a non-empty key even in no-verify mode
                algorithms=["HS256"],
                options={"verify_signature": False, "verify_exp": False, "verify_aud": False},
            )
        except Exception as e:
            logger.warning(f"JWT decode (no-verify) failed: {e}")
            return {}  # Return empty dict so user_id = None (unauthenticated dev access)

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase does not require aud verification
        )
        return payload
    except JWTError as e:
        logger.warning(f"JWT decode failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")



def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[str]:
    """
    FastAPI dependency that extracts the user_id (sub claim) from a Bearer JWT.

    - If SUPABASE_JWT_SECRET is set: verifies and decodes the token.
    - If not set (local dev): returns None so routes remain accessible.
    - If token is present but invalid: raises 401.
    """
    if credentials is None:
        # No token provided
        if settings.supabase_jwt_secret:
            raise HTTPException(status_code=401, detail="Authentication required")
        return None  # dev mode, no auth

    payload = _decode_token(credentials.credentials)
    user_id: Optional[str] = payload.get("sub")
    return user_id


def require_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> str:
    """Like get_current_user_id but always raises 401 if no valid user."""
    user_id = get_current_user_id(credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id
