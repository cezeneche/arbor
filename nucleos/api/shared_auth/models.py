from __future__ import annotations

from pydantic import BaseModel, Field


class AuthContext(BaseModel):
    sub: str
    tenant_id: str
    scopes: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    jti: str | None = None
    exp: int
