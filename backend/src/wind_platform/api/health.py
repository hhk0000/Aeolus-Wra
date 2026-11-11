"""进程健康检查，不声明外部依赖已就绪。"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from wind_platform import __version__

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["aeolus-wra"]
    version: str


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """返回当前 API 进程状态；不访问数据库或执行工程计算。"""
    return HealthResponse(status="ok", service="aeolus-wra", version=__version__)
