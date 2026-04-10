from flask import Blueprint, jsonify, request
from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_session
from backend.services.contacts_service import ContactsService
from backend.services.contacts_sync_engine import ContactsSyncEngine
from backend.models.contact import (
    ContactCreate,
    ContactUpdate,
    ContactResponse,
    ContactSyncStatus,
)
from typing import Optional
import json

contacts_bp = Blueprint("contacts", __name__)
log = get_logger(__name__)


def get_workspace_id():
    return request.headers.get("X-Workspace-ID", "default")


def get_user_email():
    return request.headers.get("X-User-Email", "")


def contacts_response(contact) -> dict:
    tags = contact.tags
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except:
            tags = []

    return {
        "id": contact.id,
        "workspace_id": contact.workspace_id,
        "type": contact.type,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "company": contact.company,
        "job_title": contact.job_title,
        "address": contact.address,
        "notes": contact.notes,
        "google_resource_name": contact.google_resource_name,
        "apple_resource_id": contact.apple_resource_id,
        "last_synced_at": contact.last_synced_at.isoformat()
        if contact.last_synced_at
        else None,
        "source": contact.source,
        "tags": tags,
        "created_at": contact.created_at.isoformat(),
        "updated_at": contact.updated_at.isoformat(),
    }


@contacts_bp.route("/contacts", methods=["GET"])
def list_contacts():
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        service = ContactsService(db, workspace_id)

        contact_type = request.args.get("type")
        search = request.args.get("search")
        source = request.args.get("source")

        contacts = service.list_contacts(contact_type, search, source)
        return jsonify([contacts_response(c) for c in contacts])
    except Exception as e:
        log.error(f"Error listing contacts: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts/<contact_id>", methods=["GET"])
def get_contact(contact_id):
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        service = ContactsService(db, workspace_id)

        contact = service.get_contact(contact_id)
        if not contact:
            return jsonify({"error": "Contact not found"}), 404

        return jsonify(contacts_response(contact))
    except Exception as e:
        log.error(f"Error getting contact: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts", methods=["POST"])
def create_contact():
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        service = ContactsService(db, workspace_id)

        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        if not data.get("name") or not data.get("email"):
            return jsonify({"error": "Name and email are required"}), 400

        contact = service.create_contact(data)
        return jsonify(contacts_response(contact)), 201
    except Exception as e:
        log.error(f"Error creating contact: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts/<contact_id>", methods=["PUT"])
def update_contact(contact_id):
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        service = ContactsService(db, workspace_id)

        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        contact = service.update_contact(contact_id, data)
        if not contact:
            return jsonify({"error": "Contact not found"}), 404

        return jsonify(contacts_response(contact))
    except Exception as e:
        log.error(f"Error updating contact: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts/<contact_id>", methods=["DELETE"])
def delete_contact(contact_id):
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        user_email = get_user_email()
        service = ContactsService(db, workspace_id)

        contact = service.get_contact(contact_id)
        if not contact:
            return jsonify({"error": "Contact not found"}), 404

        if contact.google_resource_name and user_email:
            sync_engine = ContactsSyncEngine(db, workspace_id, user_email)
            sync_engine.delete_contact_from_google(contact_id)

        success = service.delete_contact(contact_id)
        if not success:
            return jsonify({"error": "Failed to delete contact"}), 500

        return jsonify({"status": "ok", "message": "Contact deleted"})
    except Exception as e:
        log.error(f"Error deleting contact: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts/sync", methods=["POST"])
def sync_contacts():
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        user_email = get_user_email()

        if not user_email:
            return jsonify({"error": "User email required for sync"}), 400

        sync_engine = ContactsSyncEngine(db, workspace_id, user_email)
        result = sync_engine.sync_full_bidirectional()

        return jsonify({"status": "ok", "result": result})
    except Exception as e:
        log.error(f"Error syncing contacts: {e}")
        return jsonify({"error": str(e)}), 500


@contacts_bp.route("/contacts/sync/status", methods=["GET"])
def sync_status():
    try:
        db = get_mgmt_session()
        workspace_id = get_workspace_id()
        service = ContactsService(db, workspace_id)

        status = service.get_sync_status()
        return jsonify(status)
    except Exception as e:
        log.error(f"Error getting sync status: {e}")
        return jsonify({"error": str(e)}), 500
