from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SqlEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum
import uuid
from backend.data.management_db import Base
from backend.models._datetime_utils import normalize_utc
from pydantic import BaseModel, EmailStr, ConfigDict, field_serializer
from typing import Optional, List

class UserRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String)
    avatar_url = Column(String)
    # PR Auth: hash bcrypt. Nullable per a backward compat amb usuaris
    # creats abans del sistema d'auth (p.ex. el legacy "ismael-legacy" o
    # usuaris importats via OAuth). Si és None, l'usuari ha d'usar OAuth
    # o set-password per al primer login email/password.
    password_hash = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")

class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    members = relationship("Membership", back_populates="workspace", cascade="all, delete-orphan")
    vaults = relationship("Vault", back_populates="workspace", cascade="all, delete-orphan")

class Membership(Base):
    __tablename__ = "memberships"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    workspace_id = Column(String, ForeignKey("workspaces.id"), primary_key=True)
    role = Column(String, default=UserRole.VIEWER)
    permissions = Column(String, default='{"capabilities": ["read"]}') # JSON string per SQLite
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="memberships")
    workspace = relationship("Workspace", back_populates="members")

class Vault(Base):
    __tablename__ = "vaults"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey("workspaces.id"))
    name = Column(String, nullable=False)
    path_override = Column(String) # For custom storage paths
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    workspace = relationship("Workspace", back_populates="vaults")
    access = relationship("VaultAccess", back_populates="vault", cascade="all, delete-orphan")

class VaultAccess(Base):
    __tablename__ = "vault_access"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    vault_id = Column(String, ForeignKey("vaults.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id"), nullable=False)
    # JSON string: {"capabilities": ["read", "write", "delete"]}
    permissions = Column(String, default='{"capabilities": ["read"]}') 
    granted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    vault = relationship("Vault", back_populates="access")
    user = relationship("User")
    workspace = relationship("Workspace")

class ApiToken(Base):
    """Personal Access Token (PAT) per a l'API pública de Gnosi.

    Es desa NOMÉS el hash SHA-256 del token (mai el text en clar). El prefix
    visible (`gnosi_pat_xxxx…`) permet identificar-lo a la UI sense desxifrar.
    """
    __tablename__ = "api_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    workspace_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    token_prefix = Column(String, nullable=False)  # p.ex. "gnosi_pat_a1b2"
    scopes = Column(String, default="read,write")    # CSV de scopes
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked = Column(Integer, default=0)  # soft-delete (0/1)
class ShareLink(Base):
    """Public/external share link for a single vault page (Notion-style).

    The `id` IS the opaque token used in the public URL `/s/{id}`. Access is
    anonymous (no membership required) but bounded by `permission`,
    `expires_at` and `revoked`. We never hard-delete on revoke — keeping the
    row preserves an audit trail of who shared what.
    """
    __tablename__ = "share_links"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    page_id = Column(String, nullable=False, index=True)
    workspace_id = Column(String, nullable=False)
    created_by = Column(String)  # user_id of the sharer
    permission = Column(String, default="view")  # view | comment | edit
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked = Column(Integer, default=0)  # 0/1 (SQLite has no bool)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# --- Pydantic Schemas for API ---

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    avatar_url: Optional[str] = None

class WorkspaceBase(BaseModel):
    name: str
    slug: Optional[str] = None

class WorkspaceResponse(WorkspaceBase):
    id: str
    created_at: datetime
    role: Optional[str] = None

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _ser_created_at(self, v: datetime) -> str:
        return normalize_utc(v)

class UserResponse(UserBase):
    id: str
    created_at: datetime

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _ser_created_at(self, v: datetime) -> str:
        return normalize_utc(v)

class MemberResponse(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    role: str
    permissions: Optional[dict] = None
    joined_at: datetime

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("joined_at")
    def _ser_joined_at(self, v: datetime) -> str:
        return normalize_utc(v)

class RoleUpdateRequest(BaseModel):
    role: Optional[UserRole] = None
    permissions: Optional[dict] = None

class AddMemberRequest(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.VIEWER
    permissions: Optional[dict] = None

class VaultAccessRequest(BaseModel):
    vault_id: str
    user_id: str
    permissions: dict = {"capabilities": ["read"]}

class VaultAccessResponse(BaseModel):
    vault_id: str
    vault_name: str
    permissions: dict

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)
