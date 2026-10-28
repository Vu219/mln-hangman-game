import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { sfx } from "../../lib/sound";
import type { AnswerInputProps } from "./ChoiceInput";

// Thông báo cho trình đọc màn hình bằng tiếng Việt (mặc định của dnd-kit là tiếng Anh).
const announcements: Announcements = {
  onDragStart: ({ active }) => `Đã nhấc mục "${active.id}".`,
  onDragOver: ({ active, over }) => (over ? `Mục "${active.id}" đang ở vị trí của "${over.id}".` : `Mục "${active.id}" chưa ở vị trí nào.`),
  onDragEnd: ({ active, over }) => (over ? `Đã thả mục "${active.id}" vào vị trí của "${over.id}".` : `Đã thả mục "${active.id}".`),
  onDragCancel: ({ active }) => `Đã huỷ kéo mục "${active.id}".`,
};
const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: "Nhấn phím cách để nhấc mục, dùng phím mũi tên để di chuyển, nhấn phím cách lần nữa để thả, Esc để huỷ.",
};

/** Kéo thả sắp xếp dòng thời gian (có thêm nút lên/xuống cho ai khó kéo). */
export default function OrderingInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const [items, setItems] = useState<string[]>(() => question.items ?? []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    sfx.select();
    setItems((prev) => arrayMove(prev, prev.indexOf(String(e.active.id)), prev.indexOf(String(over.id))));
  };
  const move = (i: number, d: number) => {
    sfx.select();
    setItems((prev) => (i + d < 0 || i + d >= prev.length ? prev : arrayMove(prev, i, i + d)));
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-gold-300/80">Giữ và kéo để sắp xếp – sớm nhất ở trên cùng.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions }}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {items.map((item, i) => (
              <SortableItem key={item} id={item} index={i} disabled={disabled} onMove={move} last={i === items.length - 1} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" className="btn-gold w-full" disabled={disabled} onClick={() => onSubmit({ order: items })}>
        Nộp thứ tự này
      </button>
    </div>
  );
}

interface ItemProps {
  id: string;
  index: number;
  disabled: boolean;
  last: boolean;
  onMove: (i: number, d: number) => void;
}

function SortableItem({ id, index, disabled, last, onMove }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const stop = (e: React.PointerEvent | React.TouchEvent) => e.stopPropagation();
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex touch-none select-none items-center gap-2 rounded-xl border-2 bg-coal-800 px-3 py-3 ${
        isDragging ? "z-10 border-gold-300 shadow-2xl" : "border-coal-600"
      }`}
      {...attributes}
      {...listeners}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-500 font-display text-coal-950">{index + 1}</span>
      <span className="flex-1 font-bold">{id}</span>
      <span className="flex flex-col">
        <button
          type="button"
          aria-label="Đưa lên"
          disabled={disabled || index === 0}
          onPointerDown={stop}
          onTouchStart={stop}
          onClick={() => onMove(index, -1)}
          className="px-2 text-gold-300 disabled:opacity-20"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="Đưa xuống"
          disabled={disabled || last}
          onPointerDown={stop}
          onTouchStart={stop}
          onClick={() => onMove(index, 1)}
          className="px-2 text-gold-300 disabled:opacity-20"
        >
          ▼
        </button>
      </span>
    </li>
  );
}
