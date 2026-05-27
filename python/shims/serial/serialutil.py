"""Subset of serial.serialutil — only what CHIRP touches."""


class SerialException(IOError):
    """Raised on any serial I/O error."""


class SerialTimeoutException(SerialException):
    pass


# Parity
PARITY_NONE = "N"
PARITY_EVEN = "E"
PARITY_ODD = "O"
PARITY_MARK = "M"
PARITY_SPACE = "S"

# Stop bits
STOPBITS_ONE = 1
STOPBITS_ONE_POINT_FIVE = 1.5
STOPBITS_TWO = 2

# Data bits
FIVEBITS = 5
SIXBITS = 6
SEVENBITS = 7
EIGHTBITS = 8
