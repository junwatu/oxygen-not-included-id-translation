PO := strings.po
PUBLIC_DIR := public
MO := $(PUBLIC_DIR)/strings.mo
PO_PUBLIC := $(PUBLIC_DIR)/strings.po

# Tools (override if needed):
MSGFMT ?= msgfmt
MSGATTRIB ?= msgattrib
POCOUNT ?= pocount
POFILTER ?= pofilter

.PHONY: all sync build check stats fuzzy-list fuzzy-clear ai-translate ai-translate-node

all: sync build check stats

sync:
	cp $(PO) $(PO_PUBLIC)

build:
	$(MSGFMT) -cv -o $(MO) $(PO)

check:
	$(MSGFMT) -cv $(PO)
	@if command -v $(POFILTER) >/dev/null 2>&1; then \
	  $(POFILTER) $(PO) -r printf -r pythonbraceformat -r xml; \
	else \
	  echo "pofilter not found; install Translate Toolkit for extra QA (pipx install translate-toolkit)"; \
	fi

stats:
	@if command -v $(POCOUNT) >/dev/null 2>&1; then \
	  $(POCOUNT) $(PO); \
	else \
	  echo "pocount not found; install Translate Toolkit to see stats (pipx install translate-toolkit)"; \
	fi

fuzzy-list:
	$(MSGATTRIB) --only-fuzzy $(PO) | sed -n '1,200p'

fuzzy-clear:
	$(MSGATTRIB) --clear-fuzzy -o $(PO).clean $(PO); \
	mv $(PO).clean $(PO)

ai-translate:
	@if [ ! -f strings_template.pot ]; then echo "strings_template.pot not found"; exit 1; fi
	@if ! command -v python3 >/dev/null 2>&1; then echo "python3 not found"; exit 1; fi
	@python3 scripts/ai_translate_po.py --pot strings_template.pot --po $(PO)

ai-translate-node:
	@if [ ! -f strings_template.pot ]; then echo "strings_template.pot not found"; exit 1; fi
	@if ! command -v node >/dev/null 2>&1; then echo "node not found"; exit 1; fi
	@node scripts/ai_translate_po.js --pot strings_template.pot --po $(PO)
