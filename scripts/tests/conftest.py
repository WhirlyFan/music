import sys
import pathlib

# Make scripts/ importable so tests can `import ingest_applemusic`.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
