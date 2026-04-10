from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SqlEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum
import uuid
from backend.data.management_db import Base
from pydantic import BaseModel, EmailStr
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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")

class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    members = relationship("Membership", back_populates="workspace", cascade="all, delete-orphan")
    vaults = relationship("Vault", back_populates="workspace", cascade="all, delete-orphan")

class Membership(Base):
    __tablename__ = "memberships"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    workspace_id = Column(String, ForeignKey("workspaces.id"), primary_key=True)
    role = Column(String, default=UserRole.VIEWER)
    permissions = Column(String, default='{"capabilities": ["read"]}') # JSON string per SQLite
    joined_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="memberships")
    workspace = relationship("Workspace", back_populates="members")

class Vault(Base):
    __tablename__ = "vaults"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey("workspaces.id"))
    name = Column(String, nullable=False)
    path_override = Column(String) # For custom storage paths
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    granted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    vault = relationship("Vault", back_populates="access")
    user = relationship("User")
    workspace = relationship("Workspace")

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
    
    class Config:
        from_attributes = True

class UserResponse(UserBase):
    id: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class MemberResponse(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    role: str
    permissions: Optional[dict] = None
    joined_at: datetime

    class Config:
        from_attributes = True

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

    class Config:
        from_attributes = True
