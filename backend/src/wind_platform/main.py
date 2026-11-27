"""应用装配入口，业务计算不得放在此处。"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from wind_platform import __version__
from wind_platform.api.health import router as health_router
from wind_platform.api.wind import router as wind_router
from wind_platform.core.calculations import CalculationError
from wind_platform.services.store import LocalStore


def create_app(data_dir=None) -> FastAPI:
    app = FastAPI(
        title="Aeolus-Wra API",
        description="风资源自动化分析平台 · 本地开发基线",
        version=__version__,
    )
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(wind_router, prefix="/api/v1")
    app.state.wind_store = LocalStore(data_dir)

    @app.exception_handler(CalculationError)
    async def calculation_error(_request, exception):
        return JSONResponse(status_code=422, content={"detail": str(exception)})

    return app


app = create_app()
