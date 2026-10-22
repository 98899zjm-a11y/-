"""Isolated development host; no production configuration is imported."""
import os
import sys

sys.dont_write_bytecode = True

from .paths import BASE, ordinary

# openpyxl and stdlib temporary files must also stay on D, including API/test
# callers that import create_app without going through the launch script.
_temporary = ordinary(BASE / 'runtime-temp', missing=True)
_temporary.mkdir(exist_ok=True)
ordinary(_temporary)
os.environ['TEMP'] = str(_temporary)
os.environ['TMP'] = str(_temporary)
import tempfile
tempfile.tempdir = str(_temporary)

from .app import create_app, seed_demo_users

__all__ = ['create_app', 'seed_demo_users']
