import { useDialog } from '@/components/Dialog';
import { downloadHtmlAsPdf, shareHtmlAsPdf, sharePdfFile } from '@/lib/documents';

/** Download (saved on the phone, then offers Share) and Share for a printable document. */
export function usePdfActions() {
  const dialog = useDialog();
  const failed = (error: unknown) => dialog.toast((error as Error)?.message || 'Could not create the PDF', 'danger');

  const download = async (html: string, label: string) => {
    try {
      const result = await downloadHtmlAsPdf(html, label);
      if (result.status !== 'saved') return;
      const share = await dialog.confirm({ title: 'PDF downloaded', message: `${result.fileName} is saved in your Download folder.`, confirmLabel: 'Share', cancelLabel: 'Done', tone: 'success', icon: 'check-circle' });
      if (share) await sharePdfFile(result.uri, label);
    } catch (error) {
      failed(error);
    }
  };

  const share = async (html: string, label: string) => {
    try {
      await shareHtmlAsPdf(html, label);
    } catch (error) {
      failed(error);
    }
  };

  return { download, share };
}
