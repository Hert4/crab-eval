"""
Test suite for sidecar-bridge FastAPI server.

Simulates evaluation requests without requiring full EnvScaler pipeline.
Can run with: pytest test_server.py -v

Features:
- Mock data fixtures for various evaluation scenarios
- Tests API endpoints (health, envs, run)
- Tests with different auth types and configurations
- Simulates both success and error cases
"""

import pytest
import sys
from unittest.mock import patch, MagicMock
from datetime import datetime

# Mock EnvScaler modules to avoid Python 3.8 type hint issues
sys.modules['envscaler_env'] = MagicMock()
sys.modules['skel_builder'] = MagicMock()
sys.modules['scen_generator'] = MagicMock()

# Now we can safely import FastAPI and server components
from fastapi.testclient import TestClient

from server import app
from server_models import (
    RunRequest, RecordInput, EvalConfig, RecordMetadata,
    RecordResult, ChecklistResult, AggregateStats
)


# ─── Test Client ──────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


# ─── Mock Data Fixtures ───────────────────────────────────────────────────────

@pytest.fixture
def mock_record_successful():
    """Mock a successful evaluation record."""
    return RecordResult(
        record_id="record_001",
        status="success",
        score=1.0,  # All checks passed
        steps=5,
        duration_ms=2341,
        trajectory=[
            {"step": 1, "action": "observe", "observation": "Environment initialized"},
            {"step": 2, "action": "query", "response": "Found user in database"},
            {"step": 3, "action": "update", "observation": "Updated user status"},
            {"step": 4, "action": "verify", "observation": "Changes verified"},
            {"step": 5, "action": "end", "observation": "Task completed"},
        ],
        checklist_results=[
            ChecklistResult(check_item="User status changed to 'active'", passed=True),
            ChecklistResult(check_item="Email field updated", passed=True),
            ChecklistResult(check_item="Timestamp set correctly", passed=True),
        ],
    )


@pytest.fixture
def mock_record_partial():
    """Mock a partially successful record (80% pass rate)."""
    return RecordResult(
        record_id="record_002",
        status="success",
        score=0.80,  # 4 out of 5 checks passed
        steps=7,
        duration_ms=3100,
        trajectory=[
            {"step": 1, "action": "observe", "observation": "Environment initialized"},
            {"step": 2, "action": "query", "response": "Found user"},
            {"step": 3, "action": "update", "observation": "Attempted update"},
            {"step": 4, "action": "verify", "observation": "Partial verification failed"},
        ],
        checklist_results=[
            ChecklistResult(check_item="User found in database", passed=True),
            ChecklistResult(check_item="Status updated to active", passed=True),
            ChecklistResult(check_item="Email verified", passed=True),
            ChecklistResult(check_item="Notification sent", passed=True),
            ChecklistResult(check_item="Audit log recorded", passed=False),
        ],
    )


@pytest.fixture
def mock_record_error():
    """Mock a failed evaluation record."""
    return RecordResult(
        record_id="record_003",
        status="error",
        score=0.0,
        steps=2,
        duration_ms=1200,
        error="Connection to database timeout",
    )


@pytest.fixture
def mock_record_truncated():
    """Mock a truncated record (max steps exceeded)."""
    return RecordResult(
        record_id="record_004",
        status="truncated",
        score=0.60,
        steps=20,  # Max steps reached
        duration_ms=15000,
        trajectory=[
            {"step": i, "action": f"action_{i}", "observation": f"Step {i} executed"} 
            for i in range(1, 21)
        ],
        checklist_results=[
            ChecklistResult(check_item="First part completed", passed=True),
            ChecklistResult(check_item="Second part attempted", passed=False),
            ChecklistResult(check_item="Third part started", passed=False),
        ],
    )


# ─── Request Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def basic_run_request():
    """Create a basic evaluation request."""
    return RunRequest(
        run_id="run_test_001",
        task_name="user_update",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test-key-123",
        base_url="https://api.openai.com/v1",
        records=[
            RecordInput(
                id="record_001",
                input="Update user status to active",
                tools=[],
                metadata=RecordMetadata(
                    env_id="user_management",
                    init_config={"user_id": 123, "initial_status": "inactive"}
                )
            ),
        ],
        eval_config=EvalConfig(
            max_steps=20,
            temperature=0.7,
            infer_mode="fc",
        )
    )


@pytest.fixture
def multi_record_request():
    """Create a request with multiple records."""
    return RunRequest(
        run_id="run_test_batch",
        task_name="database_operations",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test-key-456",
        base_url="https://api.custom-gateway.com/v1",
        records=[
            RecordInput(
                id=f"record_{i:03d}",
                input=f"Task {i}: Update record {i}",
                tools=[{"name": "database_update", "schema": {}}],
                metadata=RecordMetadata(
                    env_id="database",
                    init_config={"record_id": i}
                )
            )
            for i in range(1, 4)
        ],
        eval_config=EvalConfig(
            max_steps=15,
            temperature=0.5,
            infer_mode="fc",
        )
    )


@pytest.fixture
def request_with_auth_types():
    """Create requests with different authentication types."""
    return [
        RunRequest(
            run_id="run_bearer",
            task_name="test_bearer",
            model="gpt-4",
            model_provider="openai",
            api_key="sk-test-bearer-key",
            base_url="https://api.openai.com/v1",
            records=[
                RecordInput(
                    id="bearer_test",
                    input="Test bearer auth",
                    metadata=RecordMetadata(env_id="test")
                )
            ],
        ),
        RunRequest(
            run_id="run_x_api_key",
            task_name="test_x_api_key",
            model="mistral",
            model_provider="custom",
            api_key="mistral-key-xyz",
            base_url="https://api.mistral.ai/v1",
            custom_headers={"X-API-Key": "custom-header-value"},
            records=[
                RecordInput(
                    id="x_api_key_test",
                    input="Test X-API-Key auth",
                    metadata=RecordMetadata(env_id="test")
                )
            ],
        ),
    ]


# ─── Health & Basic Endpoint Tests ────────────────────────────────────────────

def test_health_endpoint(client):
    """Test health check endpoint."""
    response = client.get("/envscaler/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_envs_endpoint(client):
    """Test environment list endpoint."""
    response = client.get("/envscaler/envs")
    assert response.status_code == 200
    data = response.json()
    assert "envs" in data
    assert isinstance(data["envs"], list)


# ─── Request Validation Tests ─────────────────────────────────────────────────

def test_run_with_empty_records(client):
    """Test that empty records list is rejected."""
    request = {
        "run_id": "run_empty",
        "task_name": "test",
        "model": "gpt-4",
        "model_provider": "openai",
        "api_key": "sk-test",
        "base_url": "https://api.openai.com/v1",
        "records": [],  # Empty
        "eval_config": {"max_steps": 20}
    }
    response = client.post("/envscaler/run", json=request)
    assert response.status_code == 422  # Validation error


def test_run_missing_required_fields(client):
    """Test that missing required fields are rejected."""
    request = {
        "run_id": "run_incomplete",
        "task_name": "test",
        # Missing model, model_provider, api_key, base_url, records
    }
    response = client.post("/envscaler/run", json=request)
    assert response.status_code == 422  # Validation error


# ─── Mock Evaluation Tests ────────────────────────────────────────────────────

@patch('server_runner.run_record')
def test_run_single_successful_record(mock_run_record, client, basic_run_request, mock_record_successful):
    """Test evaluation with single successful record."""
    mock_run_record.return_value = mock_record_successful

    response = client.post("/envscaler/run", json=basic_run_request.model_dump())
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify response structure
    assert data["run_id"] == "run_test_001"
    assert data["status"] == "completed"
    assert len(data["results"]) == 1
    
    # Verify result details
    result = data["results"][0]
    assert result["record_id"] == "record_001"
    assert result["status"] == "success"
    assert result["score"] == 1.0
    assert result["steps"] == 5
    assert len(result["checklist_results"]) == 3
    
    # Verify aggregate stats
    assert data["aggregate"]["total"] == 1
    assert data["aggregate"]["passed"] == 1  # score >= 0.99
    assert data["aggregate"]["avg_score"] == 1.0
    assert data["aggregate"]["avg_steps"] == 5.0


@patch('server_runner.run_record')
def test_run_multiple_records_mixed_results(
    mock_run_record, client, multi_record_request,
    mock_record_successful, mock_record_partial, mock_record_truncated
):
    """Test evaluation with multiple records of different outcomes."""
    mock_run_record.side_effect = [
        mock_record_successful,
        mock_record_partial,
        mock_record_truncated,
    ]

    response = client.post("/envscaler/run", json=multi_record_request.model_dump())
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify response structure
    assert data["run_id"] == "run_test_batch"
    assert data["status"] == "completed"
    assert len(data["results"]) == 3
    
    # Verify aggregate stats
    aggregate = data["aggregate"]
    assert aggregate["total"] == 3
    assert aggregate["passed"] == 1  # Only record with score 1.0 counts
    assert aggregate["avg_score"] == pytest.approx((1.0 + 0.80 + 0.60) / 3, abs=0.01)
    assert aggregate["avg_steps"] == (5 + 7 + 20) / 3


@patch('server_runner.run_record')
def test_run_with_errors(mock_run_record, client, multi_record_request, mock_record_error):
    """Test evaluation with error results."""
    mock_run_record.return_value = mock_record_error

    response = client.post("/envscaler/run", json=multi_record_request.model_dump())
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify status shows partial when error occurred
    assert data["status"] == "partial"
    
    result = data["results"][0]
    assert result["status"] == "error"
    assert result["score"] == 0.0
    assert result["error"] is not None
    assert "timeout" in result["error"].lower()


# ─── Authentication & Configuration Tests ─────────────────────────────────────

@patch('server_runner.run_record')
def test_run_bearer_token_auth(mock_run_record, client, mock_record_successful):
    """Test with Bearer token authentication."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="run_bearer_test",
        task_name="auth_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-bearer-test-key",
        base_url="https://api.openai.com/v1",
        records=[
            RecordInput(id="auth_001", input="Test bearer")
        ],
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    assert response.status_code == 200
    
    # Verify that run_record was called with correct parameters
    call_args = mock_run_record.call_args
    assert call_args[1]["api_key"] == "sk-bearer-test-key"
    assert call_args[1]["base_url"] == "https://api.openai.com/v1"


@patch('server_runner.run_record')
def test_run_custom_gateway(mock_run_record, client, mock_record_successful):
    """Test with custom gateway (non-OpenAI provider)."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="run_custom_gateway",
        task_name="custom_test",
        model="mistral-large",
        model_provider="mistral",
        api_key="mistral-api-key-xyz",
        base_url="https://api.mistral.ai/v1",
        custom_headers={
            "X-Custom-Header": "custom-value",
            "X-API-Key": "alternate-key"
        },
        records=[
            RecordInput(id="custom_001", input="Test custom gateway")
        ],
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    assert response.status_code == 200
    
    # Verify custom headers were passed
    call_args = mock_run_record.call_args
    assert call_args[1]["custom_headers"] is not None
    assert "X-Custom-Header" in call_args[1]["custom_headers"]


@patch('server_runner.run_record')
def test_run_with_custom_eval_config(mock_run_record, client, mock_record_successful):
    """Test with custom evaluation configuration."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="run_custom_config",
        task_name="config_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[
            RecordInput(id="config_001", input="Test config")
        ],
        eval_config=EvalConfig(
            max_steps=50,
            temperature=0.1,
            infer_mode="prompt",
            enable_thinking=True,
        )
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    assert response.status_code == 200
    
    # Verify config values were passed
    call_args = mock_run_record.call_args
    assert call_args[1]["max_steps"] == 50
    assert call_args[1]["temperature"] == 0.1
    assert call_args[1]["infer_mode"] == "prompt"
    assert call_args[1]["enable_thinking"] is True


# ─── Pass/Fail Threshold Tests ────────────────────────────────────────────────

@patch('server_runner.run_record')
def test_pass_threshold_exactly_099(mock_run_record, client):
    """Test that score exactly 0.99 counts as passed."""
    record_099 = RecordResult(
        record_id="record_099",
        status="success",
        score=0.99,  # Exactly at threshold
        steps=10,
    )
    mock_run_record.return_value = record_099
    
    request = RunRequest(
        run_id="run_threshold_099",
        task_name="threshold_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="test_099", input="Test")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    data = response.json()
    
    assert data["aggregate"]["passed"] == 1  # Should pass


@patch('server_runner.run_record')
def test_pass_threshold_below_099(mock_run_record, client):
    """Test that score below 0.99 does not count as passed."""
    record_098 = RecordResult(
        record_id="record_098",
        status="success",
        score=0.98,  # Just below threshold
        steps=10,
    )
    mock_run_record.return_value = record_098
    
    request = RunRequest(
        run_id="run_threshold_098",
        task_name="threshold_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="test_098", input="Test")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    data = response.json()
    
    assert data["aggregate"]["passed"] == 0  # Should NOT pass


@patch('server_runner.run_record')
def test_pass_threshold_above_099(mock_run_record, client):
    """Test that score above 0.99 counts as passed."""
    record_100 = RecordResult(
        record_id="record_100",
        status="success",
        score=1.0,  # Above threshold
        steps=10,
    )
    mock_run_record.return_value = record_100
    
    request = RunRequest(
        run_id="run_threshold_100",
        task_name="threshold_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="test_100", input="Test")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    data = response.json()
    
    assert data["aggregate"]["passed"] == 1  # Should pass


# ─── Edge Cases & Robustness Tests ────────────────────────────────────────────

@patch('server_runner.run_record')
def test_run_very_large_batch(mock_run_record, client):
    """Test with a large batch of records (stress test)."""
    mock_record = RecordResult(
        record_id="record_large",
        status="success",
        score=0.95,
        steps=5,
    )
    mock_run_record.return_value = mock_record
    
    # Create request with 100 records
    records = [
        RecordInput(id=f"large_{i:03d}", input=f"Task {i}")
        for i in range(100)
    ]
    
    request = RunRequest(
        run_id="run_large_batch",
        task_name="stress_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=records
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    assert response.status_code == 200
    
    data = response.json()
    assert data["aggregate"]["total"] == 100


@patch('server_runner.run_record')
def test_trajectory_preservation(mock_run_record, client, mock_record_successful):
    """Test that trajectory data is preserved in response."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="run_trajectory",
        task_name="trajectory_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="traj_001", input="Test")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    data = response.json()
    
    result = data["results"][0]
    assert len(result["trajectory"]) == 5
    assert result["trajectory"][0]["step"] == 1
    assert result["trajectory"][0]["action"] == "observe"


@patch('server_runner.run_record')
def test_checklist_results_included(mock_run_record, client, mock_record_successful):
    """Test that checklist results are included in response."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="run_checklist",
        task_name="checklist_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="check_001", input="Test")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    data = response.json()
    
    result = data["results"][0]
    assert len(result["checklist_results"]) == 3
    assert all(isinstance(check["passed"], bool) for check in result["checklist_results"])


# ─── Integration Tests ─────────────────────────────────────────────────────────

@patch('server_runner.run_record')
def test_full_workflow_success_scenario(
    mock_run_record, client,
    mock_record_successful, mock_record_partial
):
    """Test a full workflow with mixed success/partial results."""
    mock_run_record.side_effect = [
        mock_record_successful,
        mock_record_partial,
    ]
    
    request = RunRequest(
        run_id="run_workflow_success",
        task_name="user_management",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-prod-key",
        base_url="https://api.openai.com/v1",
        records=[
            RecordInput(
                id="user_001",
                input="Update user Jane Doe to premium",
                tools=[
                    {"name": "database_query", "description": "Query database"},
                    {"name": "database_update", "description": "Update database"},
                ],
                metadata=RecordMetadata(
                    env_id="user_management",
                    init_config={"user_id": 1, "tier": "basic"}
                )
            ),
            RecordInput(
                id="user_002",
                input="Deactivate inactive user",
                tools=[
                    {"name": "database_query", "description": "Query database"},
                    {"name": "database_delete", "description": "Delete record"},
                ],
                metadata=RecordMetadata(
                    env_id="user_management",
                    init_config={"user_id": 2, "status": "inactive"}
                )
            ),
        ],
        eval_config=EvalConfig(
            max_steps=15,
            temperature=0.7,
        )
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    assert response.status_code == 200
    
    data = response.json()
    assert data["run_id"] == "run_workflow_success"
    assert data["status"] == "completed"
    assert len(data["results"]) == 2
    
    # First record should be successful
    assert data["results"][0]["score"] == 1.0
    assert data["results"][0]["status"] == "success"
    
    # Second record should be partial
    assert data["results"][1]["score"] == 0.80
    assert data["results"][1]["status"] == "success"
    
    # Aggregate should reflect both
    assert data["aggregate"]["total"] == 2
    assert data["aggregate"]["passed"] == 1  # Only first one >= 0.99


if __name__ == "__main__":
    # Run tests with: pytest test_server.py -v
    # Or: python -m pytest test_server.py -v
    pytest.main([__file__, "-v", "--tb=short"])
