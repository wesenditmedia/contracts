// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IFeeReceiver.sol";

contract MockFeeReceiver is IFeeReceiver {
    function onERC20Received(
        address caller,
        address token,
        address from,
        address to,
        uint256 amount
    ) external override {}
}
