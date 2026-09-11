const fs = require('fs');
const files = [
  'frontend/src/app/components/appointments/appointment-dialog/appointment-dialog.ts',
  'frontend/src/app/components/employees/employee-dialog/employee-dialog.ts'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/target: \(document\.querySelector\('\.cdk-overlay-container'\) as HTMLElement\) \|\| document\.body,?\s*/g, "");
  fs.writeFileSync(file, content, 'utf8');
}
console.log('Reverted targets!');
