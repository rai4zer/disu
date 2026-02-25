from pydantic import BaseModel
from typing import List


class Settings(BaseModel):

    horizons: List[int] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    history_years: int = 8
    min_samples: int = 600
    test_size: float = 0.2
    seed: int = 42
    model_dir: str = "models"

    calib_size: float = 0.15
    calib_method: str = "sigmoid"  # try "sigmoid" if isotonic behaves oddly
    prob_bins: int = 10

SETTINGS = Settings()
