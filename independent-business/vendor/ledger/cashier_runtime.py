"""Trusted cashier bootstrap in the existing guarded ledger process.

No request body, employee grant or browser session can choose the database or
retained numbering directory. The sidecar validates storage before calling us.
"""
from pathlib import Path


def configure(app):
    from app import db
    from erp_common import transaction
    from erp_runtime import number_store
    from cashier import register
    from cashier_numbers import create_reserver, ordinary
    from cashier_schema import initialize
    from cashier_restore import _schema

    erp_file, namespace = number_store()
    filename = Path(erp_file).with_name('cashier-number-reservations.json')
    # number_store uses the signed release context, or the original isolated
    # Stage identity. Its retained directory is outside the restored DB slot.
    filename.parent.mkdir(exist_ok=True)
    ordinary(filename, missing=True)
    reserve = create_reserver(path=filename, namespace=namespace)
    with app.app_context(), transaction() as connection:
        # Do not silently repair a partial/unknown financial schema.
        if _schema(connection) == 'absent':
            initialize(connection)
        _schema(connection)
    return register(app, connect=db.connect, reserve_number=reserve, clock=db.now_str)
