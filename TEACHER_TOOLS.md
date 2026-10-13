# Teacher tools

Restart the backend and frontend after updating. Backend startup creates indexes for the new school-year, intervention, award-history, and audit collections.

## School years and promotion

Settings → School years creates and selects the active school year. Students are enrollments for one year; assessments, scores, AI insights, interventions, and certificates are scoped to that year. Sections and subject names are shared definitions. The current school year appears above the dashboard title.

Existing records remain in **Legacy / unassigned records**. To assign them, create an empty school year, select it in Settings, and use **Assign legacy records to selected year**. This moves academic records together in a MongoDB transaction. It does not delete data.

Promotion in Year-End & Archives requires a different destination school year. Finishing creates a fresh enrollment with the next grade level, retains the current section and subjects for later editing, and archives the old enrollment in the same transaction. Graduation archives without creating another enrollment. Restore reopens the original enrollment; it keeps any already-created next-year enrollment.

## Rules and reporting

Settings controls passing/high-performing thresholds, the written-work/performance-task/examination weights, and promotion requirements. Weights must total 100. ECR transmutation, the examination's internal split, and named performance bands remain unchanged. Rules are stored per year; archived snapshots preserve the rules used when finishing.

Year-End & Archives prints filtered class reports and individual student reports. The browser print dialog can save PDF files. Awards saves reviewed certificates, which can be reopened from Award history.

## Interventions and account recovery

Interventions records assigned activities, difficulty, due dates, completion, comparable baseline/follow-up percentages, and teacher notes. AI practice cards can seed an intervention draft for teacher review.

Generate a private recovery code in Settings using the current password. The code is displayed once and stored only as a hash on the server. Use **Forgot password?** on the login screen if needed. Recovery consumes the code and invalidates previous sessions. New sessions last eight hours; sign-in/recovery attempts are limited, and repeated wrong passwords temporarily lock an account. Password changes and Sign out all sessions also invalidate old tokens.

## Backup and history

Download a JSON backup from Settings. It includes all years, archives, assessment scores, AI insight PDFs, interventions, awards, and audit history. Passwords and recovery codes are excluded. Backup files contain student records and should be stored privately.

Restore requires the current password, validates every record/reference before writing, and uses a transaction. It adds records with new IDs and separate restored school years; existing records are preserved. Choose a restored year after importing. The current UI accepts backup files up to 20 MB, and imports up to 50,000 records.

Change history records new academic records, edits, clearing/deletion, imports, archive/restore actions, and grading/account changes from this update onward. Earlier changes cannot be reconstructed. Large batch updates retain at most 100 previous records per event; backups preserve the full current dataset.
