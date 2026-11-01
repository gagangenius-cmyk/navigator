'use client';

import { useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, Save } from 'lucide-react';

export type FieldType = 'text' | 'date' | 'select' | 'textarea' | 'file' | 'number';

export interface StageField {
  name: string;
  label: string;
  type?: FieldType;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
  span?: 'full';
  /** Date fields marked true can only be set to today's date - no back-dating, no future-dating. */
  todayOnly?: boolean;
}

export type StageAccent = 'blue' | 'red';

// Full class strings (not interpolated) so Tailwind's scanner keeps them.
const ACCENT_CLASSES: Record<StageAccent, {
  focusRing: string;
  fileLink: string;
  banner: string;
  bannerText: string;
  bannerFootnote: string;
  primaryButton: string;
}> = {
  blue: {
    focusRing: 'focus:ring-blue-500',
    fileLink: 'text-blue-700 hover:text-blue-900',
    banner: 'bg-blue-50 border border-blue-200',
    bannerText: 'text-blue-800',
    bannerFootnote: 'text-blue-600',
    primaryButton: 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400',
  },
  red: {
    focusRing: 'focus:ring-red-500',
    fileLink: 'text-red-700 hover:text-red-900',
    banner: 'bg-red-50 border border-red-200',
    bannerText: 'text-red-800',
    bannerFootnote: 'text-red-600',
    primaryButton: 'bg-red-600 hover:bg-red-700 disabled:bg-red-400',
  },
};

export interface OperationsGenericStageProps {
  title: string;
  description: string;
  fields: StageField[];
  data: Record<string, any>;
  isFirstStage: boolean;
  isLastStage: boolean;
  /** Renders every field read-only and hides the save/continue buttons. */
  locked?: boolean;
  lockedMessage?: string;
  accent?: StageAccent;
  /** Optional small print under the description banner. */
  footnote?: string;
  onFieldChange: (field: StageField, value: any) => void;
  onSaveDraft: () => Promise<void>;
  onBack: () => void;
  onContinue: () => Promise<void>;
}

export function GenericStage({
  title,
  description,
  fields,
  data,
  isFirstStage,
  isLastStage,
  locked,
  lockedMessage,
  accent = 'blue',
  footnote,
  onFieldChange,
  onSaveDraft,
  onBack,
  onContinue,
}: OperationsGenericStageProps) {
  const [localSaving, setLocalSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const theme = ACCENT_CLASSES[accent];

  const handleSave = async () => {
    setLocalSaving(true);
    try {
      await onSaveDraft();
      window.toast.success(`${title} saved successfully!`);
    } catch (error) {
      window.toast.error('Failed to save data');
    } finally {
      setLocalSaving(false);
    }
  };

  const missingRequired = fields.filter((field) => field.required && !data[field.name]);

  const renderField = (field: StageField) => {
    const value = data[field.name] || '';
    const isReadOnly = field.readOnly || locked;
    const inputClass = `w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 ${theme.focusRing} disabled:bg-gray-50 disabled:text-gray-500`;
    const label = (
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {field.label}
        {field.required && <span className="ml-1 text-red-600">*</span>}
      </label>
    );

    if (field.type === 'textarea') {
      return (
        <div key={field.name} className={field.span === 'full' ? 'md:col-span-2' : ''}>
          {label}
          <textarea
            value={value}
            onChange={(event) => onFieldChange(field, event.target.value)}
            readOnly={isReadOnly}
            rows={4}
            className={inputClass}
            placeholder={field.label}
          />
        </div>
      );
    }

    if (field.type === 'select') {
      return (
        <div key={field.name}>
          {label}
          <select
            value={value}
            onChange={(event) => onFieldChange(field, event.target.value)}
            disabled={isReadOnly}
            className={inputClass}
          >
            <option value="">Select</option>
            {(field.options || []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === 'file') {
      const uploaded = value && typeof value === 'object' && 'url' in value ? value : null;
      return (
        <div key={field.name} className={field.span === 'full' ? 'md:col-span-2' : ''}>
          {label}
          {uploaded?.url && (
            <a href={uploaded.url} target="_blank" className={`mb-2 block text-xs font-medium ${theme.fileLink}`}>
              View uploaded file
            </a>
          )}
          <input
            type="file"
            onChange={(event) => onFieldChange(field, event.target.files?.[0] || null)}
            disabled={locked}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">Accepted legacy formats: png, jpeg, jpg, pdf, docx, doc, xls, xlsx.</p>
        </div>
      );
    }

    return (
      <div key={field.name}>
        {label}
        <input
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(event) => onFieldChange(field, event.target.value)}
          readOnly={isReadOnly}
          min={field.type === 'date' && field.todayOnly ? todayIso : undefined}
          max={field.type === 'date' && field.todayOnly ? todayIso : undefined}
          className={inputClass}
          placeholder={field.label}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
      <div className={`${theme.banner} rounded-lg p-6`}>
        <p className={theme.bannerText}>{description}</p>
        {footnote && <p className={`text-sm ${theme.bannerFootnote} mt-2`}>{footnote}</p>}
      </div>

      {locked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {lockedMessage || 'You do not have permission to edit this stage.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {fields.map(renderField)}
        {!locked && missingRequired.length > 0 && (
          <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Pending required fields: {missingRequired.map((field) => field.label).join(', ')}
          </div>
        )}
      </div>

      <div className="flex justify-between pt-6">
        {!isFirstStage && (
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center font-medium"
          >
            <ChevronLeft className="mr-2" size={20} />
            Back
          </button>
        )}
        {!locked && (
          <div className="flex gap-3 ml-auto">
            <button
              onClick={handleSave}
              disabled={localSaving}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 flex items-center font-medium"
            >
              <Save className="mr-2" size={20} />
              {localSaving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={async () => {
                if (missingRequired.length > 0) {
                  window.toast.warning(`Complete required fields: ${missingRequired.map((field) => field.label).join(', ')}`);
                  return;
                }
                setContinuing(true);
                try {
                  await onContinue();
                } finally {
                  setContinuing(false);
                }
              }}
              disabled={continuing}
              className={`px-6 py-3 text-white rounded-lg ${theme.primaryButton} flex items-center font-medium`}
            >
              {isLastStage ? (
                <>
                  <CheckCircle className="mr-2" size={20} />
                  Complete
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="ml-2" size={20} />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
