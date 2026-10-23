import sys
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tests'))
import python_guard_test
unittest.main(module=python_guard_test)
