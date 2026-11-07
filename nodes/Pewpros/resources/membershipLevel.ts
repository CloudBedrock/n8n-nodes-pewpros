import { INodeProperties } from 'n8n-workflow';

import { ParamGetter, RequestSpec, pathId } from '../helpers';

// Admin membership levels. Needs the "memberships" capability.
const BASE = '/api/v1/admin/membership-levels';

export const membershipLevelProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['membershipLevel'] } },
    options: [
      {
        name: 'Add Course',
        value: 'addCourse',
        action: 'Add a course to a membership level',
      },
      { name: 'Get Many', value: 'getAll', action: 'Get many membership levels' },
      {
        name: 'Remove Course',
        value: 'removeCourse',
        action: 'Remove a course from a membership level',
      },
    ],
    default: 'getAll',
  },
  {
    displayName: 'Membership Level ID',
    name: 'membershipLevelId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['membershipLevel'], operation: ['addCourse', 'removeCourse'] },
    },
  },
  {
    displayName: 'Course ID',
    name: 'levelCourseId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['membershipLevel'], operation: ['addCourse', 'removeCourse'] },
    },
    description: 'The numeric ID of the course',
  },
  {
    displayName: 'Auto Enroll',
    name: 'autoEnroll',
    type: 'boolean',
    default: true,
    displayOptions: { show: { resource: ['membershipLevel'], operation: ['addCourse'] } },
    description: 'Whether members on this level are enrolled in the course automatically',
  },
];

export function buildMembershipLevelRequest(get: ParamGetter, operation: string): RequestSpec {
  if (operation === 'getAll') {
    return { method: 'GET', path: BASE };
  }
  const levelId = pathId(get, 'membershipLevelId', 'Membership Level ID');
  const courseId = pathId(get, 'levelCourseId', 'Course ID');
  if (operation === 'addCourse') {
    return {
      method: 'POST',
      path: `${BASE}/${levelId}/courses`,
      // The server only turns auto-enroll off for a JSON `false`.
      body: { course_id: Number(courseId), auto_enroll: get('autoEnroll', true) !== false },
    };
  }
  if (operation === 'removeCourse') {
    return { method: 'DELETE', path: `${BASE}/${levelId}/courses/${courseId}` };
  }
  throw new Error(`Pewpros: unknown membership level operation "${operation}"`);
}
