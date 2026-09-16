"""Cozy Village game backend.

A guest in the Moru process, not a part of Moru. It has its own database, its own player
table and its own tokens; nothing in this package writes to a Moru table and nothing in Moru
reads a Cozy one. What it does reuse is the plumbing that is not about identity - the mailer, the
password hashing and the JWT codec - because a second copy of those is a second thing to keep
correct.
"""
