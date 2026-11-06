export default function ReportLoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">This report could not be loaded.</p>
      <p className="mt-1">{message} - the figures below are not live data. Please refresh, or try again in a moment.</p>
    </div>
  );
}
