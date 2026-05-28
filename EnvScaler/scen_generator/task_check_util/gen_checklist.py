"""
Generate checklist items for task verification.
"""
from typing import Tuple, List
from utils.call_llm import llm_inference


# Prompt template for generating checklists
input_template = \
"""You are a **Quality Checklist Generation Assistant**.
I will provide you with a **task description**. Your job is to generate a **state-change checklist** — every item must verify that the agent *modified* the environment, not just queried it.

**Requirements:**
1. Every checklist item must verify a **state change**: something that was created, updated, or deleted. Items that only verify a pre-existing value (i.e., no write action was required) are **forbidden**.
2. Each checklist item must be **independent** and **not rely** on the results of other items.
3. Every checklist item must start with the **exact phrase**: **"Has …"** followed by a clear description of the change to verify.
4. Use precise fields and exact values from the task description; **avoid vague wording**.
5. If the task requires modifying multiple fields, **split them into separate checklist items**.
6. List the items in **logical order**, ensuring each is **self-contained**.
7. **Output format:**
   - Use Markdown list syntax (`- `) for each checklist item
   - Each item must start with **"Has …"** and be **verifiable as a diff between initial state and final state**

---

**Example:**

Task description:
Register a new hospital device with ID DEV-9Z88H, model VNT-900, manufactured by Radiant Health Systems, install it at location LOC-RESP-01 (type: ward), and ensure maintenance schedule MSCH-0101 has a `compliance_status` of `compliant`.

Expected CheckList:
- Has the new device DEV-9Z88H been added to the system (did not exist in initial state)?
- Has the model_number of DEV-9Z88H been set to "VNT-900"?
- Has the manufacturer of DEV-9Z88H been set to "Radiant Health Systems"?
- Has the location LOC-RESP-01 been created (did not exist in initial state)?
- Has the type of location LOC-RESP-01 been set to "ward"?
- Has the compliance_status of maintenance schedule MSCH-0101 been changed to "compliant"?

---

Now, generate the checklist for the following task:
{task}

Output Format (strictly follow this):
# Analysis
<Your step-by-step reasoning: identify every state change the task requires>

# CheckList
- Has ...
- Has ...
- ...
"""

def parse_response(output_text: str, api_key=None, base_url=None) -> Tuple[bool, List[str]]:
    """Parse checklist items from LLM output."""
    if "</think>" in output_text:
        output_text = output_text.split("</think>")[1]

    parse_success = False
    checklist = []

    # Normalize line breaks and split
    lines = output_text.strip().splitlines()
    # Flag to detect we are inside "# CheckList" section
    in_checklist_section = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# CheckList"):
            in_checklist_section = True
            continue
        if in_checklist_section:
            # Stop parsing if we hit another section header
            if stripped.startswith("# ") and not stripped.startswith("# CheckList"):
                break
            # Checklist item lines must start with "- "
            if stripped.startswith("- "):
                checklist.append(stripped[2:].strip())

    if checklist:
        parse_success = True

    return parse_success, checklist

def gen_checklist(model: str, task: str, api_key: str, base_url: str) -> List[str]:
    """Generate checklist items for the given task using LLM."""
    input_content = input_template.format(task=task)
    messages = [
        {"role": "user", "content": input_content},
    ]
    cur_try = 0
    max_try = 5
    while cur_try < max_try:
        cur_try += 1
        output_text = llm_inference(provider="openai", model=model, messages=messages, api_key=api_key, base_url=base_url)
        parse_success, checklist = parse_response(output_text)
        if parse_success:
            break
    return checklist