import { useEffect } from "react";

const MIN_COLUMN_WIDTH = 56;
const STORAGE_PREFIX = "nms.tableColumnWidths";

function visibleHeaders(table) {
  const row = table.querySelector("thead tr:last-child");
  if (!row) return [];
  return Array.from(row.children).filter((cell) => cell.tagName === "TH" && Number(cell.colSpan || 1) === 1);
}

function storageKeyFor(table, headers) {
  const route = `${window.location.pathname}${window.location.hash || ""}`;
  const tables = Array.from(document.querySelectorAll("table"));
  const tableIndex = Math.max(0, tables.indexOf(table));
  const labels = headers.map((header) => header.textContent.trim().replace(/\s+/g, " ")).join("|");
  return `${STORAGE_PREFIX}:${route}:${tableIndex}:${labels}`;
}

function numericWidth(value) {
  const parsed = Number.parseFloat(String(value || "").replace("px", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function setTableWidth(table, cols) {
  const total = Array.from(cols).reduce((sum, col) => sum + Math.max(MIN_COLUMN_WIDTH, numericWidth(col.style.width)), 0);
  table.style.setProperty("--table-resize-width", `${Math.ceil(total)}px`);
}

function saveWidths(key, cols) {
  const widths = Array.from(cols).map((col) => Math.max(MIN_COLUMN_WIDTH, Math.round(numericWidth(col.style.width))));
  localStorage.setItem(key, JSON.stringify(widths));
}

function readSavedWidths(key, count) {
  try {
    const widths = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(widths) || widths.length !== count) return null;
    return widths.map((width) => Math.max(MIN_COLUMN_WIDTH, Number(width) || MIN_COLUMN_WIDTH));
  } catch {
    return null;
  }
}

function ensureColgroup(table, headers, key) {
  let colgroup = table.querySelector("colgroup[data-resizable-generated='true']");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    colgroup.dataset.resizableGenerated = "true";
    table.insertBefore(colgroup, table.firstChild);
  }

  while (colgroup.children.length < headers.length) {
    colgroup.appendChild(document.createElement("col"));
  }
  while (colgroup.children.length > headers.length) {
    colgroup.lastElementChild?.remove();
  }

  const cols = Array.from(colgroup.children);
  const savedWidths = readSavedWidths(key, headers.length);
  cols.forEach((col, index) => {
    const width = savedWidths?.[index] || numericWidth(col.style.width) || headers[index].getBoundingClientRect().width || 120;
    col.style.width = `${Math.max(MIN_COLUMN_WIDTH, Math.round(width))}px`;
  });
  setTableWidth(table, cols);
  return cols;
}

function startResize(event, table, cols, index, key) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startWidth = Math.max(MIN_COLUMN_WIDTH, numericWidth(cols[index].style.width) || cols[index].getBoundingClientRect().width);

  document.body.classList.add("table-column-resizing");

  function move(moveEvent) {
    const width = Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX);
    cols[index].style.width = `${Math.round(width)}px`;
    setTableWidth(table, cols);
  }

  function stop() {
    document.body.classList.remove("table-column-resizing");
    saveWidths(key, cols);
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", stop);
  }

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", stop);
}

function applyResizableColumns() {
  document.querySelectorAll("table").forEach((table) => {
    if (table.dataset.columnResizeDisabled === "true") return;
    const headers = visibleHeaders(table);
    if (!headers.length) return;

    table.classList.add("resizable-table");
    const key = storageKeyFor(table, headers);
    const cols = ensureColgroup(table, headers, key);

    headers.forEach((header, index) => {
      header.classList.add("resizable-table-header");
      let handle = header.querySelector(":scope > .table-column-resizer");
      if (!handle) {
        handle = document.createElement("span");
        handle.className = "table-column-resizer";
        handle.setAttribute("aria-hidden", "true");
        header.appendChild(handle);
      }
      handle.onmousedown = (event) => startResize(event, table, cols, index, key);
    });
  });
}

export default function TableColumnResizer() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyResizableColumns);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
