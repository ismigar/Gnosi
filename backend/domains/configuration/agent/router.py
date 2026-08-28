"""Shared router singleton for governed agent configuration APIs."""

from fastapi import APIRouter

router = APIRouter(prefix="/ai", tags=["AI Skills"])
