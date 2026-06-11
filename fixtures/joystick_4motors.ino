// Joystick-controlled DC motors via two L298N drivers
// L298N #1 (n3): IN1=D2, IN2=D3 -> controls motors 1&2 (left side)
// L298N #2 (n4): IN1=D4, IN2=D5 -> controls motors 3&4 (right side)
// Joystick: VRX=A0 (left/right), VRY=A1 (forward/backward)

// Pin definitions
const int VRX_PIN = A0;   // Joystick X axis (left/right steering)
const int VRY_PIN = A1;   // Joystick Y axis (forward/backward)

// L298N Driver 1 (left motors)
const int IN1_L = 2;      // Left motor forward
const int IN2_L = 3;      // Left motor backward

// L298N Driver 2 (right motors)
const int IN1_R = 4;      // Right motor forward
const int IN2_R = 5;      // Right motor backward

// Dead zone threshold around center (512 +/- deadzone)
const int DEADZONE = 80;

// Helper: set a motor driver direction
// dir: 1=forward, -1=backward, 0=stop
void setMotor(int pinIN1, int pinIN2, int dir) {
  if (dir > 0) {
    digitalWrite(pinIN1, HIGH);  // Forward
    digitalWrite(pinIN2, LOW);
  } else if (dir < 0) {
    digitalWrite(pinIN1, LOW);   // Backward
    digitalWrite(pinIN2, HIGH);
  } else {
    digitalWrite(pinIN1, LOW);   // Stop (coast)
    digitalWrite(pinIN2, LOW);
  }
}

void setup() {
  // Set motor control pins as outputs
  pinMode(IN1_L, OUTPUT);
  pinMode(IN2_L, OUTPUT);
  pinMode(IN1_R, OUTPUT);
  pinMode(IN2_R, OUTPUT);

  // Stop all motors initially
  setMotor(IN1_L, IN2_L, 0);
  setMotor(IN1_R, IN2_R, 0);

  Serial.begin(9600); // For debugging (optional)
}

void loop() {
  int vrx = analogRead(VRX_PIN); // 0-1023, center ~512 (left/right)
  int vry = analogRead(VRY_PIN); // 0-1023, center ~512 (fwd/back)

  // Convert to -1, 0, +1 based on dead zone
  int xDir = 0; // left/right
  int yDir = 0; // forward/backward

  // Y axis: below center = forward, above center = backward
  if (vry < (512 - DEADZONE)) {
    yDir = 1;   // Forward (joystick pushed up/forward)
  } else if (vry > (512 + DEADZONE)) {
    yDir = -1;  // Backward (joystick pushed down/back)
  }

  // X axis: below center = turn left, above center = turn right
  if (vrx < (512 - DEADZONE)) {
    xDir = -1;  // Turn left
  } else if (vrx > (512 + DEADZONE)) {
    xDir = 1;   // Turn right
  }

  // Determine left and right motor commands
  // Mixing: turning overrides straight drive
  int leftDir  = 0;
  int rightDir = 0;

  if (yDir != 0 && xDir == 0) {
    // Pure forward or backward: both sides same direction
    leftDir  = yDir;
    rightDir = yDir;
  } else if (xDir == -1 && yDir == 0) {
    // Spin left in place: left backward, right forward
    leftDir  = -1;
    rightDir = 1;
  } else if (xDir == 1 && yDir == 0) {
    // Spin right in place: left forward, right backward
    leftDir  = 1;
    rightDir = -1;
  } else if (yDir == 1 && xDir == -1) {
    // Moving forward + turn left: slow left, full right
    leftDir  = 0;
    rightDir = 1;
  } else if (yDir == 1 && xDir == 1) {
    // Moving forward + turn right: full left, slow right
    leftDir  = 1;
    rightDir = 0;
  } else if (yDir == -1 && xDir == -1) {
    // Moving backward + turn left
    leftDir  = 0;
    rightDir = -1;
  } else if (yDir == -1 && xDir == 1) {
    // Moving backward + turn right
    leftDir  = -1;
    rightDir = 0;
  } else {
    // Joystick centered: stop
    leftDir  = 0;
    rightDir = 0;
  }

  // Apply commands to both L298N drivers
  setMotor(IN1_L, IN2_L, leftDir);   // Left side motors (n3)
  setMotor(IN1_R, IN2_R, rightDir);  // Right side motors (n4)

  // Debug output
  Serial.print("VRX: "); Serial.print(vrx);
  Serial.print(" VRY: "); Serial.print(vry);
  Serial.print(" L: "); Serial.print(leftDir);
  Serial.print(" R: "); Serial.println(rightDir);

  delay(50); // Small delay for stability
}