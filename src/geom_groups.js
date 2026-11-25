// MuJoCo geom groups of the robot and the scene. Groups only filter rays and rendering; contacts use contype.
/** The robot's visual meshes (robot.xml, mjlab's convention). */
export const ROBOT_VISUAL_GROUP = 1;
/** The robot's collision geoms (robot.xml). */
export const ROBOT_COLLISION_GROUP = 3;
/** Walkable surfaces: floors, stair treads and lift decks. The elevation map sees only these, as the policy's
 * training terrain held only ground; walls, glazing and furniture stay in group 0. */
export const WALKABLE_GROUP = 4;
/** Scene geoms that rays must ignore, such as open lift gates (elevator.js). */
export const EXCLUDED_GROUP = 5;
