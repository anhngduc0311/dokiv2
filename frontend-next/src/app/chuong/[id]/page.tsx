import { MigrationPlaceholder } from '@/components/layout/migration-placeholder';
export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <MigrationPlaceholder title={`Đọc truyện · ${id}`} />; }
