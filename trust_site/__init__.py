"""trust-site: a Referee-style site for a Lean library, built from an S2 dataset and S3 evidence."""
from .build import Options, build

__all__ = ["Options", "build"]
__version__ = "0.3.0"
