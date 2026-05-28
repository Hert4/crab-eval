"""
Hand-written MISA-style HR env. Schema matches the company's real
organization vocabulary so birthday queries / wish CRUD tasks score against
fields the agent can actually fill in (no LLM-invented schemas).

Org hierarchy fields on each employee:
    block       — Khối (e.g. "Khối Sản xuất", "Khối KD thị trường doanh nghiệp")
    ban         — Ban (e.g. "Ban Giám đốc TTKD Bán thêm", "Ban Công nghệ thông tin")
    trung_tam   — Trung tâm (e.g. "Trung tâm KD Bán thêm - Hồ Chí Minh")
    phong       — Phòng (e.g. "Phòng KD bán thêm 01", "Phòng Đào tạo")
    nhom        — Nhóm (e.g. "Nhóm KD bán thêm GP ký điện tử")
    van_phong   — Văn phòng (e.g. "Văn phòng Sản xuất", "Văn phòng Đà Nẵng")
    position    — Vị trí (e.g. "lập trình viên", "trưởng phòng đào tạo", "HRBP")
    project     — Dự án (e.g. "EMIS Công lập", "AMIS Kế toán HKD")
    product     — Sản phẩm (e.g. "AMIS Quản lý sản xuất", "MISA TaskGo")

All comparisons are case-insensitive substring matches so callers can pass
short or partial values from natural language.

Date filtering accepts either:
    - structured fields: month, year, quarter, day, week_offset, month_offset, year_offset
    - or explicit ISO range: date_from, date_to (YYYY-MM-DD)
"""
import datetime
import re
import uuid


def _ci_contains(haystack, needle) -> bool:
    if needle is None:
        return True
    if haystack is None:
        return False
    return str(needle).strip().lower() in str(haystack).strip().lower()


def _parse_dob(value) -> datetime.date | None:
    if not value:
        return None
    try:
        return datetime.datetime.strptime(str(value), "%Y-%m-%d").date()
    except Exception:
        return None


def _match_org(emp: dict, block=None, ban=None, trung_tam=None, phong=None,
               nhom=None, van_phong=None, position=None, project=None,
               product=None, team=None) -> bool:
    return (_ci_contains(emp.get("block"), block)
        and _ci_contains(emp.get("ban"), ban)
        and _ci_contains(emp.get("trung_tam"), trung_tam)
        and _ci_contains(emp.get("phong"), phong)
        and _ci_contains(emp.get("nhom"), nhom)
        and _ci_contains(emp.get("van_phong"), van_phong)
        and _ci_contains(emp.get("position"), position)
        and _ci_contains(emp.get("project"), project)
        and _ci_contains(emp.get("product"), product)
        and _ci_contains(emp.get("team"), team))


def _resolve_date_range(day=None, month=None, year=None, quarter=None,
                        week_offset=None, month_offset=None,
                        year_offset=None, day_offset=None,
                        date_from=None, date_to=None) -> tuple:
    today = datetime.date.today()
    if date_from or date_to:
        try:
            d1 = datetime.datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else None
            d2 = datetime.datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else d1
            return d1, d2
        except Exception:
            return None, None
    if day_offset is not None:
        t = today + datetime.timedelta(days=day_offset)
        return t, t
    if week_offset is not None:
        monday = today - datetime.timedelta(days=today.weekday())
        monday = monday + datetime.timedelta(weeks=week_offset)
        return monday, monday + datetime.timedelta(days=6)
    if quarter is not None:
        y = year if year is not None else today.year
        q_start_month = (quarter - 1) * 3 + 1
        start = datetime.date(y, q_start_month, 1)
        end_month = q_start_month + 2
        if end_month == 12:
            end = datetime.date(y, 12, 31)
        else:
            end = datetime.date(y, end_month + 1, 1) - datetime.timedelta(days=1)
        return start, end
    if month is not None:
        y = year if year is not None else today.year
        if day is not None:
            d = datetime.date(y, month, day)
            return d, d
        start = datetime.date(y, month, 1)
        end = (datetime.date(y + (month // 12), (month % 12) + 1, 1)
               - datetime.timedelta(days=1))
        return start, end
    if month_offset is not None:
        tm = today.month + month_offset
        y = today.year + (tm - 1) // 12
        m = ((tm - 1) % 12) + 1
        start = datetime.date(y, m, 1)
        end = (datetime.date(y + (m // 12), (m % 12) + 1, 1)
               - datetime.timedelta(days=1))
        return start, end
    if year_offset is not None or year is not None:
        y = year if year is not None else today.year + (year_offset or 0)
        return datetime.date(y, 1, 1), datetime.date(y, 12, 31)
    return None, None


def _birthday_in(dob, start, end) -> bool:
    if dob is None or start is None or end is None:
        return False
    cur = start
    while cur <= end:
        if (cur.month, cur.day) == (dob.month, dob.day):
            return True
        cur += datetime.timedelta(days=1)
        if (cur - start).days > 366:
            break
    return False


class MISAHRSystem:
    """
    MISA-style human resources system: employee directory with deep org
    hierarchy, birthday tracking, and birthday-wish messaging workflow.

    State:
        employees: dict[employee_id, dict] — employee records
        wishes:    dict[wish_id, dict]    — draft birthday wishes
        comms:     dict[comm_id, dict]    — communication log (sent wishes)
    """

    def __init__(self, employees: dict = None, wishes: dict = None, comms: dict = None):
        self.employees = employees or {}
        self.wishes = wishes or {}
        self.comms = comms or {}

    # ── Employee directory ──────────────────────────────────────────────

    def list_employees(self, block: str = None, ban: str = None,
                       trung_tam: str = None, phong: str = None, nhom: str = None,
                       van_phong: str = None, position: str = None,
                       project: str = None, product: str = None,
                       team: str = None) -> dict:
        """List employees, optionally filtered by any org hierarchy field. All filters AND'd, case-insensitive substring match."""
        out = [e for e in self.employees.values()
               if _match_org(e, block, ban, trung_tam, phong, nhom,
                                  van_phong, position, project, product, team)]
        return {"success": True, "data": out}

    def find_employee_by_id(self, employee_id: str) -> dict:
        """Look up an employee by their unique employee_id (e.g. 'C21-0041')."""
        emp = self.employees.get(employee_id)
        if not emp:
            return {"success": False, "error": "Employee not found"}
        return {"success": True, "data": emp}

    def find_employee_by_name(self, name: str, position: str = None) -> dict:
        """Find first employee whose name contains the given substring (case-insensitive). Optional position filter."""
        candidates = [e for e in self.employees.values()
                      if _ci_contains(e.get("name"), name)
                      and _ci_contains(e.get("position"), position)]
        if not candidates:
            return {"success": False, "error": "No employee matches"}
        return {"success": True, "data": candidates[0]}

    def update_employee_field(self, employee_id: str, field: str, value) -> dict:
        """Set a single field on an employee record (e.g. phone, facebook_url, address)."""
        emp = self.employees.get(employee_id)
        if not emp:
            return {"success": False, "error": "Employee not found"}
        emp[field] = value
        return {"success": True, "message": "Field updated"}

    # ── Birthday filtering ──────────────────────────────────────────────

    def list_birthdays(self, day: int = None, month: int = None, year: int = None,
                       quarter: int = None, day_offset: int = None,
                       week_offset: int = None, month_offset: int = None,
                       year_offset: int = None, date_from: str = None,
                       date_to: str = None, block: str = None, ban: str = None,
                       trung_tam: str = None, phong: str = None, nhom: str = None,
                       van_phong: str = None, position: str = None,
                       project: str = None, product: str = None,
                       team: str = None) -> dict:
        """
        List employees whose birthday falls in a date window AND match the given org filters.
        Date window built from any combination of: day/month/year, quarter+year, offsets, or explicit date_from/date_to.
        Examples:
            day_offset=0    → today
            day_offset=-1   → yesterday
            day_offset=1    → tomorrow
            week_offset=0   → this week
            week_offset=1   → next week
            month=10, year=2025 → October 2025
            quarter=1, year=2025 → Q1 2025
            year_offset=-1  → last year
        """
        start, end = _resolve_date_range(
            day=day, month=month, year=year, quarter=quarter,
            day_offset=day_offset, week_offset=week_offset,
            month_offset=month_offset, year_offset=year_offset,
            date_from=date_from, date_to=date_to,
        )
        out = []
        for e in self.employees.values():
            if not _match_org(e, block, ban, trung_tam, phong, nhom,
                                   van_phong, position, project, product, team):
                continue
            dob = _parse_dob(e.get("date_of_birth"))
            if start is None and end is None:
                if dob and (dob.month, dob.day) == (datetime.date.today().month, datetime.date.today().day):
                    out.append(e)
            elif _birthday_in(dob, start, end):
                out.append(e)
        return {"success": True, "data": out, "date_range": {
            "from": start.isoformat() if start else None,
            "to":   end.isoformat() if end else None,
        }}

    # ── Wish CRUD ──────────────────────────────────────────────────────

    def create_wish(self, employee_id: str, content: str, tone: str = "default") -> dict:
        """Create a draft birthday wish for an employee. Tones: default, hai_huoc, manh_me, ba_dao, etc."""
        if employee_id not in self.employees:
            return {"success": False, "error": "Employee not found"}
        wid = str(uuid.uuid4())
        self.wishes[wid] = {
            "id": wid, "employee_id": employee_id,
            "content": content, "tone": tone, "sent": False,
        }
        return {"success": True, "data": {"wish_id": wid}}

    def list_wishes(self, employee_id: str = None, sent: bool = None) -> dict:
        """List wish drafts, optionally filtered by employee or sent status."""
        out = [w for w in self.wishes.values()
               if (employee_id is None or w["employee_id"] == employee_id)
               and (sent is None or w["sent"] == sent)]
        return {"success": True, "data": out}

    def update_wish(self, wish_id: str = None, employee_id: str = None,
                    new_content: str = None, new_tone: str = None) -> dict:
        """Update content/tone of a wish. Identify wish by wish_id or by employee_id (most recent unsent)."""
        target = None
        if wish_id:
            target = self.wishes.get(wish_id)
        elif employee_id:
            for w in reversed(list(self.wishes.values())):
                if w["employee_id"] == employee_id and not w["sent"]:
                    target = w
                    break
        if not target:
            return {"success": False, "error": "Wish not found"}
        if new_content is not None: target["content"] = new_content
        if new_tone is not None:    target["tone"] = new_tone
        return {"success": True, "data": {"wish_id": target["id"]}}

    def update_wish_for_employee_name(self, name: str, new_content: str = None,
                                      new_tone: str = None) -> dict:
        """Find the most-recent unsent wish for an employee whose name contains the substring, then update it."""
        target_emp = None
        for e in self.employees.values():
            if _ci_contains(e.get("name"), name):
                target_emp = e
                break
        if not target_emp:
            return {"success": False, "error": "No employee matches name"}
        return self.update_wish(employee_id=target_emp.get("employee_id") or target_emp.get("id"),
                                new_content=new_content, new_tone=new_tone)

    def append_to_wish(self, wish_id: str, text: str) -> dict:
        """Append text to an existing wish."""
        w = self.wishes.get(wish_id)
        if not w:
            return {"success": False, "error": "Wish not found"}
        w["content"] = (w["content"] + " " + text).strip()
        return {"success": True, "message": "Appended"}

    def delete_wish(self, wish_id: str = None, employee_id: str = None) -> dict:
        """Delete a draft wish by id or by employee (all that person's unsent wishes)."""
        if wish_id:
            if wish_id not in self.wishes:
                return {"success": False, "error": "Wish not found"}
            del self.wishes[wish_id]
            return {"success": True, "message": "Wish deleted"}
        if employee_id:
            to_remove = [wid for wid, w in self.wishes.items()
                         if w["employee_id"] == employee_id and not w["sent"]]
            for wid in to_remove:
                del self.wishes[wid]
            return {"success": True, "data": {"deleted_count": len(to_remove)}}
        return {"success": False, "error": "Provide wish_id or employee_id"}

    def delete_wishes_except_employee_name(self, keep_name: str) -> dict:
        """Delete all unsent wishes EXCEPT those for the employee whose name matches."""
        keeper_ids = {(e.get("employee_id") or e.get("id"))
                      for e in self.employees.values()
                      if _ci_contains(e.get("name"), keep_name)}
        to_remove = [wid for wid, w in self.wishes.items()
                     if w["employee_id"] not in keeper_ids and not w["sent"]]
        for wid in to_remove:
            del self.wishes[wid]
        return {"success": True, "data": {"deleted_count": len(to_remove)}}

    # ── Send ───────────────────────────────────────────────────────────

    def send_wish(self, wish_id: str = None, employee_id: str = None) -> dict:
        """Send a single wish: mark sent=True and log in communications. Identify by wish_id or employee_id."""
        w = None
        if wish_id:
            w = self.wishes.get(wish_id)
        elif employee_id:
            for cand in reversed(list(self.wishes.values())):
                if cand["employee_id"] == employee_id and not cand["sent"]:
                    w = cand
                    break
        if not w:
            return {"success": False, "error": "Wish not found"}
        if w.get("sent"):
            return {"success": False, "error": "Wish already sent"}
        cid = str(uuid.uuid4())
        self.comms[cid] = {
            "id": cid, "wish_id": w["id"], "employee_id": w["employee_id"],
            "content": w["content"], "tone": w.get("tone", "default"),
            "sent_at": datetime.datetime.now().isoformat(),
        }
        w["sent"] = True
        return {"success": True, "data": {"communication_id": cid}}

    def send_default_wish_to_employees(self, employee_ids: list,
                                        default_content: str = "Chúc mừng sinh nhật!") -> dict:
        """Send a default wish to each employee in the list. Auto-creates the wish then sends it."""
        comm_ids = []
        for eid in employee_ids:
            if eid not in self.employees:
                continue
            r = self.create_wish(eid, default_content, tone="default")
            if r.get("success"):
                wid = r["data"]["wish_id"]
                self.send_wish(wish_id=wid)
                comm_ids.append(wid)
        return {"success": True, "data": {"sent_count": len(comm_ids)}}

    def send_wishes_by_name_match(self, name_substring: str,
                                   default_content: str = "Chúc mừng sinh nhật!") -> dict:
        """Send default wish to ALL employees whose name contains the substring (e.g. all 'thu hà')."""
        targets = [e for e in self.employees.values()
                   if _ci_contains(e.get("name"), name_substring)]
        eids = [e.get("employee_id") or e.get("id") for e in targets if (e.get("employee_id") or e.get("id"))]
        return self.send_default_wish_to_employees(eids, default_content)
