"""Custom middleware shim. We use `django_rls.middleware.RLSContextMiddleware`
in settings.MIDDLEWARE — it handles set_config('rls.user_id', ...) +
clean-up on response/exception. This module is kept for future custom
middleware (e.g. request-scoped pghistory context).
"""
