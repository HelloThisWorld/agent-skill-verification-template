# Examples — openmind-glossary

## Answered (doc term)

Input: `define Ledger`

- status: `answered`
- claim: `Ledger: The append-only book of balanced postings kept for every tenant.`
  citing `fixtures/openmind-corpus/GLOSSARY.md:9`

## Answered (term that is also a code symbol)

Input: `define RateTable`

- claim 1 cites `GLOSSARY.md:11` (the verbatim table definition)
- claim 2 cites `app/rates.py:6` (`class RateTable:` — the real definition site)

## Insufficient evidence (unknown term)

Input: `define Blockchain`

- status: `insufficient_evidence`, claims: `[]`
- answer: `no authoritative definition found for 'Blockchain' in the indexed project`
