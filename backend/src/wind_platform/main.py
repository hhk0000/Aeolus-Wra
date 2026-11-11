"""应用装配入口，业务计算不得放在此处。"""

from fastapi import FastAPI

from wind_platform import __version__
from wind_platform.api.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Aeolus-Wra API",
        description="风资源自动化分析平台 · 本地开发基线",
        version=__version__,
    )
    app.include_router(health_router, prefix="/api/v1")
    return app


app = create_app()
