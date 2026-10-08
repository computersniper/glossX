"""GlossX agent harness: capabilities, evidence context, plan/execute/verify loop.

The package is deliberately small: ``capabilities`` defines the ABI every tool,
sub-agent and source implements; ``context`` owns grounded evidence spans;
``loop`` runs one goal end to end; ``runs`` makes runs observable, cancellable
and persistent for the HTTP layer.
"""
from __future__ import annotations
