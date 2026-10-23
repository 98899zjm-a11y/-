import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'project/desktop/legacy-source/ledger'))
from erp_values import money, weight, quantity

class ValuesTest(unittest.TestCase):
 def test_cents_are_exact(self):
  self.assertEqual(money('100.01'),10001)
  self.assertEqual(money('0.00'),0)
  self.assertEqual(money('0001.20'),120)
 def test_unsafe_and_ambiguous_numbers_are_rejected(self):
  for value in [True,1.2,None,'NaN','Infinity','1e6','1.001','-1','1;DROP','9'*30]:
   with self.subTest(value=value),self.assertRaises(ValueError):money(value)
 def test_measured_weight_stays_separate_and_exact(self):
  self.assertEqual(weight('3.2'),'3.2000')
  self.assertEqual(weight('3.2001'),'3.2001')
  for value in ['-1','3.20001','Infinity',True]:
   with self.assertRaises(ValueError):weight(value)
  self.assertEqual(quantity(2),2)
  for value in [True,0,-1,1.2,'2']:
   with self.assertRaises(ValueError):quantity(value)

if __name__=='__main__':unittest.main()
