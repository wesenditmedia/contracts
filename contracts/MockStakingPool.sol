// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IStakingPool.sol";

contract MockStakingPool is IStakingPool {
    event ERC20Received(address from, uint256 amount);

    function onERC20Received(address from, uint256 amount) external override {
        emit ERC20Received(from, amount);
    }
}
