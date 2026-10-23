"""Freeze only the date input of the original inventory report algorithm.

The original .pyc still chooses range labels and performs every aggregation.
Ordinary interactive requests without ``since`` remain completely unchanged.
"""
import datetime
import re
from flask import request
from werkzeug.exceptions import BadRequest


def install_report_window(application):
    view = application.view_functions.get('report.index')
    seen = set()
    for _ in range(16):
        if not callable(view) or id(view) in seen:
            raise RuntimeError('Unknown inventory report view; date adapter refused')
        seen.add(id(view))
        namespace = getattr(view, '__globals__', {})
        if namespace.get('__name__') == 'app.views_report':
            break
        view = getattr(view, '__wrapped__', None)
    else:
        raise RuntimeError('Inventory report view wrapper depth exceeded')
    original = namespace.get('_range_args')
    if not callable(original):
        raise RuntimeError('Original inventory date selector is unavailable')
    if getattr(original, '_xjy_frozen_report_window', False):
        return

    def frozen_range():
        if 'since' not in request.args:
            return original()
        if len(request.args.getlist('r')) != 1 or len(request.args.getlist('since')) != 1:
            raise BadRequest('Report date and range must be unique')
        period = request.args['r']
        since = request.args['since']
        if period not in ('30', '90', '365', 'all'):
            raise BadRequest('Unsupported report range')
        if period == 'all':
            if since != '':
                raise BadRequest('All-time report cannot have a start date')
        else:
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', since):
                raise BadRequest('Invalid report date')
            try:
                datetime.date.fromisoformat(since)
            except ValueError as error:
                raise BadRequest('Invalid report date') from error
        result = original()
        if not isinstance(result, tuple) or len(result) != 3 or result[0] != period:
            raise RuntimeError('Original inventory date selector contract changed')
        return result[0], (since + ' 00:00' if since else ''), result[2]

    frozen_range._xjy_frozen_report_window = True
    namespace['_range_args'] = frozen_range
