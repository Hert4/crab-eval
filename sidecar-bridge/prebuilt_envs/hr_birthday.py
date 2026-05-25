"""
Hand-written HR Birthday env class — bypasses LLM code generation.

Covers the operations needed by the birthday_sample dataset:
  - employee directory: list with filters (department/group/role/team), lookup by id/name
  - birthday today list
  - update employee fields (e.g. facebook)
  - wish CRUD: create, list, update, append, remove-text, delete
  - send wish (commits to communications log)

All methods return {"success": bool, ...} consistent with EnvScaler's
expected return format (so step5 check_returns is implicitly satisfied).
"""
import datetime
import uuid


class HRBirthdaySystem:
    """
    HR management system with employee directory, birthday tracking,
    and birthday-wish messaging workflow.

    State:
        employees: dict[str, dict] — employee records keyed by employee_id
        wishes:    dict[str, dict] — draft birthday-wish messages keyed by wish_id
        comms:     dict[str, dict] — sent communications log keyed by communication_id
    """

    def __init__(self, employees: dict = None, wishes: dict = None, comms: dict = None):
        self.employees = employees or {}
        self.wishes = wishes or {}
        self.comms = comms or {}

    # ── employee directory ──────────────────────────────────────────────

    def list_employees(self, department: str = None, group: str = None,
                       role: str = None, team: str = None) -> dict:
        """List all employees, optionally filtered by department, group, role, or team (case-insensitive substring match)."""
        out = []
        for e in self.employees.values():
            if department and department.lower() not in str(e.get("department", "")).lower():
                continue
            if group and group.lower() not in str(e.get("group", "")).lower():
                continue
            if role and role.lower() not in str(e.get("role", "")).lower():
                continue
            if team and team.lower() not in str(e.get("team", "")).lower():
                continue
            out.append(e)
        return {"success": True, "data": out}

    def get_employee_by_id(self, employee_id: str) -> dict:
        """Retrieve an employee record by its employee_id."""
        emp = self.employees.get(employee_id)
        if not emp:
            return {"success": False, "error": "Employee not found"}
        return {"success": True, "data": emp}

    def get_employee_by_name(self, name: str) -> dict:
        """Find the first employee whose name contains the given substring (case-insensitive)."""
        matches = [e for e in self.employees.values()
                   if name.lower() in str(e.get("name", "")).lower()]
        if not matches:
            return {"success": False, "error": "No employee matches name"}
        return {"success": True, "data": matches[0]}

    def update_employee_field(self, employee_id: str, field: str, value: str) -> dict:
        """Update a single field on an employee record (e.g. facebook, phone)."""
        emp = self.employees.get(employee_id)
        if not emp:
            return {"success": False, "error": "Employee not found"}
        emp[field] = value
        return {"success": True, "message": "Field updated"}

    # ── birthday tracking ──────────────────────────────────────────────

    def list_birthdays_today(self) -> dict:
        """List employees whose date_of_birth (month/day) matches today."""
        today = datetime.date.today()
        out = []
        for e in self.employees.values():
            dob_str = str(e.get("date_of_birth", ""))
            try:
                dob = datetime.datetime.strptime(dob_str, "%Y-%m-%d").date()
                if (dob.month, dob.day) == (today.month, today.day):
                    out.append(e)
            except Exception:
                continue
        return {"success": True, "data": out}

    # ── wish CRUD ──────────────────────────────────────────────────────

    def create_wish(self, employee_id: str, content: str, style: str = "default") -> dict:
        """Create a draft birthday wish for a specific employee."""
        if employee_id not in self.employees:
            return {"success": False, "error": "Employee not found"}
        wid = str(uuid.uuid4())
        self.wishes[wid] = {
            "id": wid,
            "employee_id": employee_id,
            "content": content,
            "style": style,
            "sent": False,
        }
        return {"success": True, "data": {"wish_id": wid}}

    def list_wishes(self, employee_id: str = None, sent: bool = None) -> dict:
        """List draft wishes, optionally filtered by employee or sent status."""
        out = []
        for w in self.wishes.values():
            if employee_id and w.get("employee_id") != employee_id:
                continue
            if sent is not None and w.get("sent") != sent:
                continue
            out.append(w)
        return {"success": True, "data": out}

    def update_wish(self, wish_id: str, new_content: str = None, new_style: str = None) -> dict:
        """Update the content and/or style of an existing wish draft."""
        w = self.wishes.get(wish_id)
        if not w:
            return {"success": False, "error": "Wish not found"}
        if new_content is not None:
            w["content"] = new_content
        if new_style is not None:
            w["style"] = new_style
        return {"success": True, "message": "Wish updated"}

    def append_to_wish(self, wish_id: str, text: str) -> dict:
        """Append a snippet of text to an existing wish's content."""
        w = self.wishes.get(wish_id)
        if not w:
            return {"success": False, "error": "Wish not found"}
        w["content"] = (w["content"] + " " + text).strip()
        return {"success": True, "message": "Appended"}

    def remove_text_from_wishes(self, text: str, employee_id: str = None) -> dict:
        """Remove a substring from one or all wish contents (optionally scoped to one employee)."""
        count = 0
        for w in self.wishes.values():
            if employee_id and w.get("employee_id") != employee_id:
                continue
            if text in w["content"]:
                w["content"] = w["content"].replace(text, "").strip()
                count += 1
        return {"success": True, "data": {"updated_count": count}}

    def delete_wish(self, wish_id: str) -> dict:
        """Delete a wish draft."""
        if wish_id not in self.wishes:
            return {"success": False, "error": "Wish not found"}
        del self.wishes[wish_id]
        return {"success": True, "message": "Wish deleted"}

    # ── send ───────────────────────────────────────────────────────────

    def send_wish(self, wish_id: str) -> dict:
        """Send a wish (mark as sent and log it to the communications log)."""
        w = self.wishes.get(wish_id)
        if not w:
            return {"success": False, "error": "Wish not found"}
        if w.get("sent"):
            return {"success": False, "error": "Wish already sent"}
        cid = str(uuid.uuid4())
        self.comms[cid] = {
            "id": cid,
            "wish_id": wish_id,
            "employee_id": w["employee_id"],
            "content": w["content"],
            "sent_at": datetime.datetime.now().isoformat(),
        }
        w["sent"] = True
        return {"success": True, "data": {"communication_id": cid}}

    def send_wishes_for_employees(self, employee_ids: list) -> dict:
        """Send all unsent wishes belonging to the given list of employee IDs."""
        sent_ids = []
        for eid in employee_ids:
            for w in list(self.wishes.values()):
                if w.get("employee_id") == eid and not w.get("sent"):
                    self.send_wish(w["id"])
                    sent_ids.append(w["id"])
        return {"success": True, "data": {"sent_wish_ids": sent_ids}}
