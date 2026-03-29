# Directive: Analyze Excel Structure

## 1. Context
We frequently need to inspect Excel files (`.xlsx` or `.xls`) to understand their schema, column names, and data types before processing them. This directive establishes the standard procedure for this analysis using Python in the sandbox.

## 2. Rules & Constraints
1.  **Library**: Use `pandas` and `openpyxl` (engine='openpyxl' for .xlsx, 'xlrd' is deprecated for .xlsx).
2.  **Idempotency**: The script must be read-only on the source file. It must not modify the input file.
3.  **Output**:
    - Print the list of columns.
    - Print the data types of each column (`dtype`).
    - Print the first 3 rows of the dataframe to visualize sample data.
    - Check for effectively empty columns (all NaN).
4.  **Error Handling**:
    - Handle `FileNotFoundError`.
    - Handle `BadZipFile` (corrupt Excel).
    - Handle missing sheets (default to first sheet unless specified).

## 3. Standard Procedure (Algorithm)
1.  **Define Target**: Set the absolute path to the Excel file.
2.  **Load**: `df = pd.read_excel(path, engine='openpyxl')`.
3.  **Inspect**:
    - `print(f"Columns: {df.columns.tolist()}")`
    - `print(f"Types:\n{df.dtypes}")`
    - `print(f"Head:\n{df.head(3)}")`
4.  **Report**: Print findings to stdout in a clean, human-readable format.

## 4. Example Snippet
```python
import pandas as pd
import sys

file_path = "path/to/file.xlsx"
try:
    df = pd.read_excel(file_path, engine='openpyxl')
    print("--- Structure ---")
    print(df.info())
    print("\n--- Sample Data ---")
    print(df.head(3))
except Exception as e:
    print(f"Error reading Excel: {e}")
    sys.exit(1)
```
