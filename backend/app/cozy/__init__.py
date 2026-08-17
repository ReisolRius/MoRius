"""Cozy Village game backend.

A guest in the MoRius process, not a part of MoRius. It has its own database, its own player
table and its own tokens; nothing in this package writes to a MoRius table and nothing in MoRius
reads a Cozy one. What it does reuse is the plumbing that is not about identity - the mailer, the
password hashing and the JWT codec - because a second copy of those is a second thing to keep
correct.
"""
