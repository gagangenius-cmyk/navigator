'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Clock, AlertCircle, Shield, ChevronLeft, RefreshCw } from 'lucide-react';

export default function RetainedStage({ lead, data, setData, onRefreshCompliance, onCloseWon, closingWon, onPrevious }: any) {
  const canClose = data.agreementComplianceStatus === 'approved';
  const isRejected = data.agreementComplianceStatus === 'rejected';
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshClick = async () => {
    setRefreshing(true);
    try {
      await onRefreshCompliance();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Shield className="mr-3 text-blue-600" size={28} />
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Retention & Compliance Review</h3>
            <p className="text-gray-600 text-sm">Compliance manager review for approval</p>
          </div>
        </div>
        <button
          onClick={handleRefreshClick}
          disabled={refreshing}
          className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center font-medium text-sm"
        >
          <RefreshCw className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} size={16} />
          Refresh Status
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="mr-2 text-yellow-600" size={20} />
          <span className="text-sm text-yellow-800">This agreement requires compliance officer approval before closing or marking the opportunity won.</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2 text-green-800 font-semibold">
            <CheckCircle size={18} />
            Payment Verified
          </div>
          <p className="text-xs text-green-700 mt-1">Accounts verification is complete for this opportunity.</p>
        </div>
        <div className={`rounded-lg border p-4 ${canClose ? 'border-green-200 bg-green-50' : isRejected ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
          <div className={`flex items-center gap-2 font-semibold ${canClose ? 'text-green-800' : isRejected ? 'text-red-800' : 'text-yellow-800'}`}>
            {canClose ? <CheckCircle size={18} /> : isRejected ? <XCircle size={18} /> : <Clock size={18} />}
            Agreement {canClose ? 'Approved' : isRejected ? 'Rejected' : 'Pending'}
          </div>
          <p className={`text-xs mt-1 ${canClose ? 'text-green-700' : isRejected ? 'text-red-700' : 'text-yellow-700'}`}>
            Compliance manager must approve the signed agreement before close.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Compliance Status</label>
          <div className={`w-full p-3 border rounded-lg capitalize font-medium ${
            canClose ? 'bg-green-50 border-green-200 text-green-700' :
            isRejected ? 'bg-red-50 border-red-200 text-red-700' :
            'bg-yellow-50 border-yellow-200 text-yellow-700'
          }`}>
            {data.agreementComplianceStatus.replace('_', ' ')}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Compliance Manager</label>
          <input
            type="text"
            value={data.complianceManager}
            onChange={(e) => setData({ ...data, complianceManager: e.target.value })}
            className="w-full p-3 border rounded-lg"
            placeholder="Enter manager name"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Review Notes</label>
        <textarea
          value={data.reviewNotes}
          onChange={(e) => setData({ ...data, reviewNotes: e.target.value })}
          rows={4}
          className="w-full p-3 border rounded-lg"
          placeholder="Enter review comments..."
        />
      </div>

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium"
        >
          <ChevronLeft className="mr-2" size={20} />
          Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={onCloseWon}
            disabled={!canClose || closingWon}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
          >
            <CheckCircle className="mr-2" size={20} />
            {closingWon ? 'Closing...' : 'Close / Mark Won'}
          </button>
        </div>
      </div>
    </div>
  );
}
