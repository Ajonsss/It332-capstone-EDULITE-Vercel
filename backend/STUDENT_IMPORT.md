# Importing students from Excel

The import screen currently supports student names only. Grade and individual-assessment imports are disabled for now, including direct API uploads. Previously saved grades and assessment records remain available to the normal grading and reporting features.

1. Open **Manage your class > Add class** in the intended school year. The guided panel opens on the right.
2. Enter **Grade Level**, choose or create a **Section**, then choose or create a **Subject**. Select **Save class & add students**, then **Import students**. The import uses those class details automatically. The class remains registered even before students are added.
3. Select **Download class template**. The application fills the grade and section at the top of the single **Students** sheet.
4. Paste one student's full name per row, starting at row 9 below the **Student Name** header. Save as .xlsx.
5. Upload and select **Review import**. Check the file, grade, section, school year, names, and existing or new registrations.
6. Acknowledge the details, then select **Confirm and import**. **Back to edit** returns to the form without importing anything.

## Workbook and registration rules

The Students sheet stores Grade Level in B4 and Section Name in B5. Keep the title, labels, worksheet name, and row 8 header unchanged. The active download contains no subject, grade, assessment, or score sheets. Imports accept up to 1,000 students and 5 MB per file.

The Add class flow enrolls imported names in its selected subject. Matching name, grade, and section registrations in the active school year gain that subject without replacing their other enrollments or saved grades; the preview explains this before confirmation. Names-only imports outside class setup keep existing enrollments unchanged unless explicitly requested. Repeated names in the workbook are listed as skipped. Distinct learners with identical identity fields need individual registration.

The selected section must already belong to the teacher when downloading, reviewing, and confirming. Workbook metadata must match the selected class. Class setup saves the section and subject together before importing; the upload itself never creates sections automatically.

Grade or assessment workbooks, including earlier multi-sheet templates and ECR workbooks, are rejected before registration writes. Grades and scores beside names are also rejected. Use a fresh student names template for the current flow.

## Final confirmation

Preview performs database reads only. A signed confirmation token lasts 15 minutes and binds the uploaded bytes, class, teacher, school year, section, and saved registrations. Changed files, selected sections, saved records, school years, or expired reviews require another review. Authentication tokens cannot be used as import confirmation tokens.

Imports for one teacher are serialized within one API process. Known partial registration failures return exact workbook row locations and preserve successful registrations for a safe retry. If completion cannot be confirmed, reload the student list and review again before retrying.

## API

All routes require the existing Bearer authentication.

- GET /api/students/import/template?mode=names&grade_level=7&section_id=<owned section ID> downloads the prefilled names sheet. Other modes return 400.
- POST /api/students/import/preview accepts multipart file, import_mode=names, grade_level, section_id, and optional subject_ids (a JSON array of owned subject IDs, default []). enroll_existing=true adds selected subjects to matching existing students; it defaults to false and requires at least one subject. These choices are bound to the confirmation token. An optional section_name must match the stored section name; the stored name is always used.
- POST /api/students/import accepts the same fields plus confirmation_token to finalize.
- POST /api/sections with name registers a section. The UI selects the returned section immediately; student import still requires final confirmation.

Responses use 200 for success, 207 for known partial registration failures, 422 for invalid workbooks or class mismatches, 400 for unavailable sections or unsupported modes, 409 for stale or missing confirmation, and 413 for oversized files.

The earlier roster-only API contract remains available for single-sheet Students workbooks with Grade Level, Section, and Student Name columns and existing subject selection. It cannot import grades or assessment records. Internal parsers and stored-grade compatibility remain for existing records; they do not enable grade imports through the routes above.

## Verification

Run the student import, guided import, assessment import rejection, and stored-grade compatibility tests in backend; run the import UI tests, ESLint, and production build in frontend. Checks cover names-only downloads, section registration and ownership, preview without writes, final confirmation, duplicate registrations, preservation of saved grades, and rejection of grade or assessment uploads.
