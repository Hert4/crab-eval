"""
Generate check functions for task verification.
"""
import json
import re
import ast
from typing import Tuple
from utils.call_llm import llm_inference


# Prompt template for generating check functions
input_template = \
"""You are a Python verification function generation assistant.
You will be given:
- Environment introduction (env_introduction), describing the overall context and purpose of the system.
- Environment initial state (initial_state), the database state **before** any agent modifications.
- A single check item, phrased as "Has ...", describing a **state change** the agent must have performed.

Your task:

Generate a Python function that validates whether the state **changed correctly** from `initial_state` to `final_state`.

---

Rules:
1. The function signature MUST be `def check_func(init_state, final_state)` — it receives **both** states.
2. **Every check item describes a change.** The function must verify the diff:
   - "Has been added / created" → entity exists in `final_state` but NOT in `initial_state`.
   - "Has been deleted / removed" → entity existed in `initial_state` but NOT in `final_state`.
   - "Has been set / updated / changed to X" → field value differs between `initial_state` and `final_state`, and equals X in `final_state`.
3. Always use `initial_state` to confirm the baseline — do NOT pass if the value was already X before the agent ran.
4. Always reference field names and value formats from `initial_state` to match the actual schema.
5. If the check item involves auto-generated fields (UUIDs, timestamps), verify the field exists in `final_state` with the correct type, and optionally that it differs from `initial_state`.
6. If the check item describes a non-fixed target value (e.g., "add a remark"), verify the field is non-empty in `final_state` and differs from `initial_state`.
7. If the check item specifies an explicit target value, strictly match it (`==`) in `final_state`.
8. The function must return `True` if the check passes, `False` otherwise. No side effects.

---

Provided data:

# environment introduction:
{env_introduction}

# initial_state:
{init_config}

# complete task:
{task}

# Check item to verify:
{check_item}

---

Required output format (strictly follow):

# Analysis
<Your step-by-step reasoning: what was the state before, what change is required, how to detect it>

# Function
```python
def check_func(init_state, final_state):
    ...
```"""


def check_function_code(code_str: str) -> bool:
    """Check if code string is a valid Python function definition."""
    try:
        # Parse code with AST to detect syntax
        tree = ast.parse(code_str)
        # Check if there's a function definition at top level
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                return True
        return False
    except SyntaxError:
        return False


def parse_check_func(llm_output: str) -> Tuple[bool, str]:
    """Parse Python function code from LLM output string."""
    if '</think>' in llm_output:
        llm_output = llm_output.split('</think>')[1]
    pattern = re.compile(
        r"# Function\s*```python\s*(.*?)\s*```",
        re.DOTALL  # Allow . to match newlines
    )
    
    match = pattern.search(llm_output)
    if match:
        function_code = match.group(1).strip()
        if not check_function_code(function_code):
            return False, ""
        # Ensure function accepts (init_state, final_state) — upgrade legacy single-arg functions
        if "def check_func(final_state)" in function_code:
            function_code = function_code.replace(
                "def check_func(final_state)",
                "def check_func(init_state, final_state)",
                1,
            )
        return True, function_code
    else:
        return False, ""

def gen_check_func(model: str, init_config: dict, task: str, env_introduction: str, check_item: str, api_key=None, base_url=None) -> str:
    """Generate check function for the given task using LLM."""
    init_config_str = json.dumps(init_config, indent=4)
    input_content = input_template.format(
        init_config=init_config_str,
        check_item=check_item,
        task=task,
        env_introduction=env_introduction
    )
    messages = [
        {"role": "user", "content": input_content},
    ]
    cur_try = 0
    max_try = 5
    while cur_try < max_try:
        cur_try += 1
        output_text = llm_inference(provider="openai", model=model, messages=messages, api_key=api_key, base_url=base_url)
        parse_success, check_func = parse_check_func(output_text)
        if parse_success:
            break
    return check_func
