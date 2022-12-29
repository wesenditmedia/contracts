// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/ITokenVault.sol";

contract TokenVault is ITokenVault, Ownable {
    bool public locked = true;

    function lock() external onlyOwner {
        locked = true;
        emit Locked();
    }

    function unlock() external onlyOwner {
        locked = false;
        emit Unlocked();
    }

    function withdrawToken(
        address token,
        uint256 amount
    ) external override onlyOwner {
        require(!locked, "TokenVault: Token vault is locked");

        IERC20(token).transfer(msg.sender, amount);
        emit WithdrawToken(msg.sender, token, amount);
    }
}
