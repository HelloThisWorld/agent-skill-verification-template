# Examples — openmind-code-graphs

## Definition site

Input: `where is post_entry defined`

- status: `answered`
- claim: `post_entry is defined in fixtures/openmind-corpus/app/ledger.py at line 8 (function): def post_entry(...)`
  citing `fixtures/openmind-corpus/app/ledger.py:8`

## Usage sites

Input: `who uses convert`

- claim 1 cites the definition line (`app/rates.py`)
- claim 2: `convert is referenced by 1 file(s): fixtures/openmind-corpus/app/ledger.py`

## Unknown symbol

Input: `where is warp_speed defined`

- status: `insufficient_evidence`, claims: `[]`
