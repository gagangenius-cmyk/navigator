'use client';

import { useMemo, useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { Edit3, Eye, Search, Target, Trash2 } from 'lucide-react';
import { Lead } from '@/types/lead';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';

interface LeadKanbanSimpleProps {
  leads: Lead[];
  onLeadSelect?: (lead: Lead) => void;
  onConvertToOpportunity?: (leadId: number) => void;
  onEditLead?: (lead: Lead) => void;
  onDeleteLead?: (leadId: number) => void;
  onStatusChange?: (leadId: number, newStatus: string) => void;
}

// 'New' is a hardcoded leading column for the lifecycle sentinel status (a
// freshly-assigned lead with no disposition yet) — it's intentionally not
// part of the admin-configurable crm_lead_status list (see useLeadStatuses),
// so it's the one column not sourced from that table.
const NEW_COLUMN = { id: 'New', title: 'New', accent: 'bg-sky-500', tint: 'border-sky-100 bg-sky-50/60' };

// Catch-all trailing column: a lot of real lead data predates the current
// status dropdown entirely — free-text call-outcome notes typed straight
// into crm_forum_leads.status ("he is not interested", "no answer messaged
// on whatsapp", etc.) rather than one of the clean values below. Without
// this bucket, any such lead matches no column's exact-value filter and
// simply vanishes from the board with no indication it exists. It's a
// read-only landing spot — not a real settable status — so it isn't a valid
// drag target, but dragging a card OUT of it to a real status works
// normally and is the natural way to finally classify a legacy lead.
const OTHER_COLUMN_ID = '__other__';
const OTHER_COLUMN = { id: OTHER_COLUMN_ID, title: 'Other / Unclassified', accent: 'bg-purple-400', tint: 'border-purple-100 bg-purple-50/60' };

export default function LeadKanbanSimple({
  leads,
  onLeadSelect,
  onEditLead,
  onDeleteLead,
  onConvertToOpportunity,
  onStatusChange,
}: LeadKanbanSimpleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const { statuses } = useLeadStatuses();

  const kanbanColumns = useMemo(() => [
    NEW_COLUMN,
    ...statuses.map((s) => ({
      id: s.name,
      title: s.name,
      accent: s.kanban_accent_class,
      tint: s.kanban_tint_class,
    })),
    OTHER_COLUMN,
  ], [statuses]);

  const leadsByStatus = useMemo(() => {
    const knownIds = new Set(kanbanColumns.map((c) => c.id).filter((id) => id !== OTHER_COLUMN_ID));
    const matchesSearch = (lead: Lead) => {
      if (!normalizedSearch) return true;
      const searchable = [lead.fname, lead.mname, lead.lname, lead.email, lead.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(normalizedSearch);
    };
    return kanbanColumns.reduce<Record<string, Lead[]>>((groups, column) => {
      groups[column.id] = leads.filter((lead) => {
        if (!matchesSearch(lead)) return false;
        return column.id === OTHER_COLUMN_ID
          ? !knownIds.has(lead.status || '')
          : lead.status === column.id;
      });
      return groups;
    }, {});
  }, [leads, normalizedSearch, kanbanColumns]);

  const handleDragEnd = ({ draggableId, destination, source }: DropResult) => {
    if (!destination || destination.droppableId === source.droppableId) return;
    onStatusChange?.(Number(draggableId), destination.droppableId);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Lead pipeline</h2>
          <p className="mt-0.5 text-sm text-slate-500">Drag a lead by its handle to update its stage.</p>
        </div>
        <label className="relative block w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search leads..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
          />
        </label>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          {kanbanColumns.map((column) => {
            const columnLeads = leadsByStatus[column.id] ?? [];

            return (
              <section key={column.id} className={`overflow-hidden rounded-2xl border ${column.tint} shadow-sm`}>
                <header className="flex items-center justify-between border-b border-inherit bg-white/75 px-4 py-3.5 backdrop-blur-sm">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`size-2.5 shrink-0 rounded-full ${column.accent}`} />
                    <h3 className="truncate text-sm font-semibold text-slate-800">{column.title}</h3>
                  </div>
                  <span className="rounded-md bg-slate-900/5 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                    {columnLeads.length}
                  </span>
                </header>

                <Droppable droppableId={column.id} isDropDisabled={column.id === OTHER_COLUMN_ID}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-72 max-h-112 overflow-y-auto space-y-3 p-3 transition-colors duration-200 ${
                        snapshot.isDraggingOver ? 'bg-white/70 ring-2 ring-inset ring-blue-500/30' : ''
                      }`}
                    >
                      {columnLeads.map((lead, index) => (
                        <Draggable key={lead.id} draggableId={lead.id.toString()} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <article
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={`cursor-grab rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-[box-shadow,transform] duration-200 active:cursor-grabbing ${
                                dragSnapshot.isDragging
                                  ? 'rotate-[1deg] scale-[1.015] border-blue-200 shadow-xl ring-2 ring-blue-500/20'
                                  : 'hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md'
                              }`}
                            >
                              <p className="truncate text-sm font-semibold text-slate-900">{[lead.fname, lead.mname, lead.lname].filter(Boolean).join(' ')}</p>
                              <p className="mt-1 truncate text-xs text-slate-500">{lead.email || 'No email address'}</p>
                              <p className="mt-1 truncate text-xs text-slate-500">{lead.mobile || 'No mobile number'}</p>
                              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                                <button
                                  type="button"
                                  onClick={() => onLeadSelect?.(lead)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <Eye className="size-3.5" />
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onEditLead?.(lead)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                                  title="Edit lead"
                                >
                                  <Edit3 className="size-3.5" />
                                  Edit
                                </button>
                                {onConvertToOpportunity && (
                                  <button
                                    type="button"
                                    onClick={() => onConvertToOpportunity(Number(lead.id))}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 transition hover:border-green-300 hover:bg-green-100"
                                    title="Start Opportunity Flow"
                                  >
                                    <Target className="size-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onDeleteLead?.(Number(lead.id))}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100"
                                  title="Delete lead"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </article>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {!columnLeads.length && !snapshot.isUsingPlaceholder && (
                        <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/45 px-6 text-center text-sm text-slate-400">
                          {snapshot.isDraggingOver ? 'Release to move the lead here' : 'No leads in this stage'}
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </section>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
