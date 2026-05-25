"""
Registry of hand-written env classes that bypass Stage 1+2 LLM code generation.

To add a new env: drop a `.py` file here exporting one class, then register it
in `PREBUILT_ENVS` with summary + introduction strings used by Stage 3-5 prompts.
"""
from pathlib import Path

_DIR = Path(__file__).parent

PREBUILT_ENVS: dict = {
    "hr_birthday": {
        "file": _DIR / "hr_birthday.py",
        "class_name": "HRBirthdaySystem",
        "summary": "HRBirthdaySystem",
        "introduction": (
            "A human resources management system with an employee directory "
            "(filterable by department, group, role, team), birthday tracking, "
            "and a birthday-wish messaging workflow. Wishes can be drafted "
            "per employee, edited (update content/style, append text, "
            "remove substrings from existing wishes), deleted, and sent — "
            "sent wishes are logged to the communications log."
        ),
    },
    "misa_hr": {
        "file": _DIR / "misa_hr.py",
        "class_name": "MISAHRSystem",
        "summary": "MISAHRSystem",
        "introduction": (
            "A MISA-style human resources system. Each employee has a deep "
            "organization hierarchy (block / ban / trung_tam / phong / nhom / "
            "van_phong), a position (e.g. lập trình viên, trưởng phòng), and "
            "optional project / product affiliations. Supports: list and "
            "filter employees by any org field, lookup by id or name, list "
            "birthdays in a date window (today, tomorrow, yesterday, this/"
            "next/last week, this/next/last month, specific month+year, "
            "quarter+year, year range, or explicit date_from/date_to), "
            "update employee fields, full wish CRUD (create, list, update "
            "by id or by employee name, append text, delete by id or by "
            "employee, delete-all-except-name), and send wishes (single, "
            "batch by employee_ids, or batch by name match)."
        ),
    },
}
