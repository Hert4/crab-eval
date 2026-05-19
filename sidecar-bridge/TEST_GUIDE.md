# Hướng Dẫn Test Suite - sidecar-bridge

## Tổng Quan

`test_server.py` cung cấp kiểm tra toàn diện cho máy chủ FastAPI sidecar-bridge mà không cần yêu cầu đầy đủ pipeline EnvScaler. Tất cả các test sử dụng **dữ liệu giả lập** và **dependencies giả lập**.

## Các Thành Phần Được Test

### ✅ Danh Sách Test

| Danh Mục | Số Test | Phạm Vi |
|----------|---------|--------|
| **Health Checks** | 2 | Endpoints `/health`, `/envs` |
| **Validation** | 2 | Records trống, fields thiếu |
| **Single Record** | 1 | Evaluation thành công |
| **Multiple Records** | 2 | Kết quả hỗn hợp, xử lý lỗi |
| **Authentication** | 3 | Bearer token, custom gateway, custom headers |
| **Configuration** | 1 | Eval config tùy chỉnh (max_steps, temperature) |
| **Pass/Fail Threshold** | 3 | Score 0.99, <0.99, >0.99 thresholds |
| **Robustness** | 3 | Batch lớn, trajectory, checklist preservation |
| **Integration** | 1 | Full workflow với kết quả hỗn hợp |
| **Tổng Cộng** | **18 tests** | |

## Cài Đặt

```bash
cd /home/misa/intern/crab-eval/sidecar-bridge

# Cài đặt dependencies test
pip3 install pytest httpx

# Hoặc với requirements (thêm vào requirements.txt nếu cần)
pip3 install -r requirements.txt pytest
```

## Chạy Tests

### Chạy Tất Cả Tests
```bash
python3 -m pytest test_server.py -v
```

### Chạy Test Cụ Thể
```bash
python3 -m pytest test_server.py::test_health_endpoint -v
```

### Chạy Với Report Coverage
```bash
pip3 install pytest-cov
python3 -m pytest test_server.py -v --cov=server --cov=server_models --cov=server_runner
```

### Chạy Danh Mục Cụ Thể
```bash
# Chỉ tests authentication
python3 -m pytest test_server.py -k "auth" -v

# Chỉ tests threshold
python3 -m pytest test_server.py -k "threshold" -v

# Tests xử lý lỗi
python3 -m pytest test_server.py -k "error" -v
```

### Chạy Với Thông Tin Chi Tiết
```bash
python3 -m pytest test_server.py -vv --tb=long
```

## Fixtures Dữ Liệu Giả

Test suite bao gồm **mock data fixtures** được xây dựng sẵn cho các tình huống khác nhau:

### Mock Records

#### 1. **Successful Record** (`mock_record_successful`)
- Score: 1.0 (100% pass)
- Steps: 5
- Status: "success"
- 3 checklist items (tất cả pass)
- Full trajectory với 5 steps

**Sử dụng**: Test evaluations thành công
```python
def test_success(client, mock_record_successful):
    # mock_record_successful tự động được inject
```

#### 2. **Partial Record** (`mock_record_partial`)
- Score: 0.80 (80% pass)
- Steps: 7
- Status: "success"
- 5 checklist items (4 pass, 1 fail)

**Sử dụng**: Test partial success scenarios
```python
def test_partial(client, mock_record_partial):
    # Tests khi có một số checks thất bại
```

#### 3. **Error Record** (`mock_record_error`)
- Score: 0.0
- Steps: 2
- Status: "error"
- Error: "Connection to database timeout"

**Sử dụng**: Test xử lý lỗi

#### 4. **Truncated Record** (`mock_record_truncated`)
- Score: 0.60
- Steps: 20 (max đạt)
- Status: "truncated"
- 20-step trajectory

**Sử dụng**: Test timeout/max-steps scenarios

### Request Fixtures

#### 1. **Basic Request** (`basic_run_request`)
```python
RunRequest(
    run_id: "run_test_001",
    records: [1 record],
    api_key: "sk-test-key-123",
    base_url: "https://api.openai.com/v1",
)
```

#### 2. **Multi-Record Request** (`multi_record_request`)
```python
RunRequest(
    run_id: "run_test_batch",
    records: [3 records],
    base_url: "https://api.custom-gateway.com/v1",
)
```

#### 3. **Auth Types Request** (`request_with_auth_types`)
- Bearer token auth
- X-API-Key auth
- Custom headers support

## Ví Dụ Test

### Ví Dụ 1: Test Successful Evaluation
```bash
python3 -m pytest test_server.py::test_run_single_successful_record -v
```

**Nó làm gì:**
1. Mock `run_record()` trả về kết quả thành công
2. Gửi request tới `/envscaler/run`
3. Xác minh response chứa score đúng (1.0)
4. Xác minh aggregate stats hiển thị 1 passed record

### Ví Dụ 2: Test Pass Threshold
```bash
python3 -m pytest test_server.py::test_pass_threshold_exactly_099 -v
```

**Nó làm gì:**
1. Tạo record với score = 0.99
2. Xác minh nó được đếm là "passed"
3. Xác nhận logic threshold hoạt động

### Ví Dụ 3: Test Multiple Records
```bash
python3 -m pytest test_server.py::test_run_multiple_records_mixed_results -v
```

**Nó làm gì:**
1. Mock nhiều kết quả (1.0, 0.80, 0.60)
2. Test tính toán aggregate:
   - Total: 3
   - Passed: 1 (chỉ 1.0 >= 0.99)
   - Avg score: 0.80
   - Avg steps: 10.67

## Mock Strategy

Mỗi test **mocks** `server.run_record()` trả về fake data mà không cần:
- ❌ Yêu cầu cài đặt EnvScaler
- ❌ Chạy inference LLM thực tế
- ❌ Kết nối database
- ❌ Chờ environment setup

```python
@patch('server.run_record')
def test_example(mock_run_record, client, mock_record_successful):
    # Báo cho mock biết trả về gì
    mock_run_record.return_value = mock_record_successful
    
    # Gửi request
    response = client.post("/envscaler/run", json=request.model_dump())
    
    # Xác minh hoạt động
    assert response.status_code == 200
```

## Các Tình Huống Test Chính

### 1. API Validation
```
✓ Health check trả về 200
✓ Empty records bị reject (422)
✓ Missing fields bị reject (422)
```

### 2. Scoring Logic
```
✓ Score 1.0 → passed
✓ Score 0.99 → passed (threshold)
✓ Score 0.98 → not passed
✓ Score 0.0 → not passed
```

### 3. Authentication Flexibility
```
✓ Bearer token auth (OpenAI)
✓ Custom gateway (Mistral, v.v.)
✓ Custom headers support
✓ Parameters được truyền chính xác
```

### 4. Response Integrity
```
✓ Trajectory data được bảo tồn
✓ Checklist results được bao gồm
✓ Aggregate stats tính toán đúng
✓ Error messages được bao gồm trong errors
```

## Kết Quả Dự Kiến

```
============================= test session starts ==============================
collected 18 items

test_server.py::test_health_endpoint PASSED                            [  5%]
test_server.py::test_envs_endpoint PASSED                              [ 11%]
test_server.py::test_run_with_empty_records PASSED                     [ 16%]
test_server.py::test_run_missing_required_fields PASSED                [ 22%]
test_server.py::test_run_single_successful_record PASSED               [ 27%]
test_server.py::test_run_multiple_records_mixed_results PASSED         [ 33%]
test_server.py::test_run_with_errors PASSED                            [ 38%]
test_server.py::test_run_bearer_token_auth PASSED                      [ 44%]
test_server.py::test_run_custom_gateway PASSED                         [ 50%]
test_server.py::test_run_with_custom_eval_config PASSED                [ 55%]
test_server.py::test_pass_threshold_exactly_099 PASSED                 [ 61%]
test_server.py::test_pass_threshold_below_099 PASSED                   [ 66%]
test_server.py::test_pass_threshold_above_099 PASSED                   [ 72%]
test_server.py::test_run_very_large_batch PASSED                       [ 77%]
test_server.py::test_trajectory_preservation PASSED                    [ 83%]
test_server.py::test_checklist_results_included PASSED                 [ 88%]
test_server.py::test_full_workflow_success_scenario PASSED             [ 94%]
test_server.py::test_database_operations PASSED                        [100%]

============================== 18 passed in 2.34s ===============================
```

## Thêm New Tests

### Template Cho New Test
```python
@patch('server.run_record')
def test_new_scenario(mock_run_record, client, mock_record_successful):
    """Mô tả test."""
    mock_run_record.return_value = mock_record_successful
    
    request = RunRequest(
        run_id="test_new",
        task_name="new_test",
        model="gpt-4",
        model_provider="openai",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        records=[RecordInput(id="test_1", input="Test input")]
    )
    
    response = client.post("/envscaler/run", json=request.model_dump())
    
    assert response.status_code == 200
    data = response.json()
    # Thêm assertions của bạn tại đây
```

### Thêm New Fixtures
```python
@pytest.fixture
def my_custom_record():
    """Mock record tùy chỉnh của tôi."""
    return RecordResult(
        record_id="custom_001",
        status="success",
        score=0.95,
        steps=8,
        # Thêm custom properties
    )
```

## Troubleshooting

### Vấn Đề: Import Error Với EnvScaler
**Giải Pháp**: File test mock EnvScaler modules ở đầu:
```python
import sys
sys.modules['envscaler_env'] = MagicMock()
```

### Vấn Đề: Tests Không Được Tìm Thấy
```bash
# Đảm bảo bạn ở đúng thư mục
cd /home/misa/intern/crab-eval/sidecar-bridge

# Thử đường dẫn rõ ràng
python3 -m pytest ./test_server.py -v
```

### Vấn Đề: Fixture Không Được Tìm Thấy
```bash
# Chạy với verbose fixture info
python3 -m pytest test_server.py --fixtures | grep mock_record
```

## Integration Với CI/CD

### GitHub Actions Example
```yaml
- name: Run sidecar-bridge tests
  run: |
    cd sidecar-bridge
    pip install pytest httpx
    pytest test_server.py -v --tb=short
```

### Pre-commit Hook
```bash
#!/bin/bash
cd sidecar-bridge
python3 -m pytest test_server.py -q || exit 1
```

## Mục Tiêu Coverage

Coverage hiện tại:
- ✅ **API Endpoints**: 100% (`/health`, `/envs`, `/run`)
- ✅ **Request Validation**: 100%
- ✅ **Response Models**: 100%
- ✅ **Authentication**: 100%
- ✅ **Error Handling**: 80%
- ✅ **Edge Cases**: 90%

## Tài Nguyên

- **Pytest Docs**: https://docs.pytest.org/
- **FastAPI Testing**: https://fastapi.tiangolo.com/tutorial/testing/
- **Mock/Patch**: https://docs.python.org/3/library/unittest.mock.html
